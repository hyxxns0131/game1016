// 엔딩 컷신: 실사 정지 화면 3~4컷 + 한 줄씩 타이핑되는 자막. 클릭 = 다음, SKIP 버튼 제공.
import { resolveCuts } from '../endings.js';
import { sfx } from '../audio.js';
import { $ } from '../ui.js';

const TYPE_MS = 55;

export class EndingScene extends Phaser.Scene {
  constructor() { super('Ending'); }

  init(data) {
    this.ending = data.ending;
    this.cuts = resolveCuts(data.ending, data.endReason);
    this.header = data.header; // { text, cls }
    this.onDone = data.onDone;
    this.cutIdx = -1;
    this.lineIdx = 0;
    this.typing = null;
    this.finalShown = false;
    this.closed = false;
  }

  create() {
    this.cameras.main.setBackgroundColor('#000');
    const W = () => this.scale.width, H = () => this.scale.height;

    this.imgA = null;
    this.barTop = this.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0).setDepth(10);
    this.barBot = this.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0).setDepth(10);
    this.caption = this.add.text(0, 0, '', {
      fontFamily: '"Noto Sans KR", sans-serif', fontSize: '15px', color: '#8f887c', fontStyle: 'italic',
    }).setOrigin(0.5, 0).setDepth(11);
    this.sub = this.add.text(0, 0, '', {
      fontFamily: '"Noto Sans KR", sans-serif', fontSize: '28px', color: '#f1ead9', fontStyle: 'bold',
      align: 'center', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(11);
    this.final = this.add.text(0, 0, '', {
      fontFamily: '"Black Han Sans", sans-serif', fontSize: '40px', color: '#e8e2d6', align: 'center',
      wordWrap: { width: 900 },
    }).setOrigin(0.5).setDepth(12).setAlpha(0);
    this.nextHint = this.add.text(0, 0, '클릭하여 계속 ▸', {
      fontFamily: '"Noto Sans KR", sans-serif', fontSize: '13px', color: '#7a746a',
    }).setOrigin(1, 1).setDepth(11).setAlpha(0);
    this.tweens.add({ targets: this.nextHint, alpha: { from: 0.2, to: 0.8 }, yoyo: true, repeat: -1, duration: 700 });

    this.layout = () => {
      const w = W(), h = H(), bar = Math.round(h * 0.11);
      this.barTop.setSize(w, bar);
      this.barBot.setPosition(0, h - bar * 1.6).setSize(w, bar * 1.6);
      this.caption.setPosition(w / 2, h - bar * 1.6 + 10);
      this.sub.setPosition(w / 2, h - bar * 1.6 + 36).setWordWrapWidth(w * 0.85);
      this.sub.setFontSize(Math.max(18, Math.min(30, w / 40)));
      this.final.setPosition(w / 2, h / 2).setWordWrapWidth(w * 0.8);
      this.final.setFontSize(Math.max(22, Math.min(44, w / 30)));
      this.nextHint.setPosition(w - 20, h - 14);
      if (this.imgA) this.cover(this.imgA);
    };
    this.layout();
    this.scale.on('resize', this.layout);

    this.input.on('pointerdown', () => this.advance());
    this.keyHandler = (e) => { if (['Space', 'Enter'].includes(e.code)) this.advance(); };
    window.addEventListener('keydown', this.keyHandler);

    const ui = $('ending-ui');
    ui.classList.remove('hidden');
    const res = $('ending-result');
    res.textContent = this.header.text;
    res.className = `ending-result ${this.header.cls}`;
    this.skipHandler = () => this.close();
    $('btn-skip').addEventListener('click', this.skipHandler);

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layout);
      window.removeEventListener('keydown', this.keyHandler);
      $('btn-skip').removeEventListener('click', this.skipHandler);
      ui.classList.add('hidden');
    });

    this.nextCut();
  }

  cover(img) {
    const w = this.scale.width, h = this.scale.height;
    const s = Math.max(w / img.width, h / img.height);
    img.baseScale = s;
    img.setPosition(w / 2, h / 2 - h * 0.03).setScale(s * (img.kb || 1));
  }

  nextCut() {
    this.cutIdx += 1;
    this.lineIdx = 0;
    if (this.cutIdx >= this.cuts.length) { this.showFinal(); return; }
    const cut = this.cuts[this.cutIdx];

    const old = this.imgA;
    const img = this.add.image(0, 0, cut.img).setAlpha(0).setDepth(1);
    img.kb = 1;
    this.cover(img);
    this.imgA = img;
    this.tweens.add({ targets: img, alpha: 1, duration: 900 });
    // 켄 번즈(느린 확대 + 이동)
    this.tweens.add({
      targets: img, kb: 1.09, duration: 9000, ease: 'Sine.out',
      onUpdate: () => img.setScale(img.baseScale * img.kb),
    });
    this.tweens.add({ targets: img, x: `+=${(this.cutIdx % 2 ? -1 : 1) * 24}`, duration: 9000 });
    if (old) this.tweens.add({ targets: old, alpha: 0, duration: 900, onComplete: () => old.destroy() });

    this.caption.setText(cut.caption || '');
    this.sub.setText('');
    this.nextHint.setVisible(true);
    if (cut.lines.length) this.time.delayedCall(700, () => this.typeLine(cut.lines[0]));
  }

  typeLine(line, target = this.sub) {
    this.typing?.remove();
    let i = 0;
    target.setText('');
    this.typingFull = line;
    this.typingTarget = target;
    this.typing = this.time.addEvent({
      delay: TYPE_MS, repeat: line.length - 1,
      callback: () => {
        i += 1;
        target.setText(line.slice(0, i));
        if (line[i - 1] !== ' ' && i % 2) sfx.type();
        if (i >= line.length) this.typing = null;
      },
    });
  }

  advance() {
    if (this.closed) return;
    if (this.typing) {
      this.typing.remove();
      this.typing = null;
      this.typingTarget.setText(this.typingFull);
      return;
    }
    if (this.finalShown) { this.close(); return; }
    const cut = this.cuts[this.cutIdx];
    if (cut && this.lineIdx < cut.lines.length - 1) {
      this.lineIdx += 1;
      this.typeLine(cut.lines[this.lineIdx]);
      return;
    }
    this.nextCut();
  }

  showFinal() {
    this.finalShown = true;
    if (this.imgA) this.tweens.add({ targets: this.imgA, alpha: 0.12, duration: 1500 });
    this.caption.setText('');
    this.sub.setText('');
    this.final.setAlpha(1);
    this.time.delayedCall(600, () => this.typeLine(this.ending.final, this.final));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => setTimeout(() => this.onDone(), 0));
  }
}
