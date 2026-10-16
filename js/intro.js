// 게임 시작 전 스토리 인트로 (약 14초). 실사 영상(Higgsfield Kling) + 아래 자막. 영상이 없으면 사진으로 대체.
import { $ } from './ui.js';
import { sfx } from './audio.js';

const BEAT_MS = 3200;
const FINAL_MS = 1800;

const BEATS = [
  {
    id: 'intro1', tag: 'DAY 1 · 의무실',
    lines: ['47일 전, 교도소 의무실에서 원인 불명의 감염이 시작됐다.'],
  },
  {
    id: 'intro2', tag: 'DAY 47 · 봉쇄',
    lines: ['통신은 끊기고 교도소는 봉쇄됐다.', '하수구와 환풍구마다… 그것들이 기어 나온다.'],
    sound: 'siren',
  },
  {
    id: 'intro3', tag: '죄수', role: 'prisoner',
    lines: ['죄수 — 흩어진 열쇠 조각 3개를 찾아', '운동장 동쪽 정문을 열고 탈출하라.'],
  },
  {
    id: 'intro4', tag: '교도관', role: 'guard',
    lines: ['교도관 — 06:00 구조 헬기가 올 때까지 10분.', '문을 잠그고, 죄수를 막아라.'],
  },
];
const FINAL = '그리고 둘 다… 좀비에게 잡히면 끝이다.';

let running = null;

/** 인트로 재생. 끝나거나 건너뛰면 resolve */
export function playIntro() {
  if (running) return running;
  running = new Promise((resolve) => {
    const root = $('intro');
    const video = $('intro-video');
    const img = $('intro-img');
    const tag = $('intro-tag');
    const text = $('intro-text');
    const bar = $('intro-bar');
    const timers = [];
    let typeTimer = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      clearInterval(typeTimer);
      window.removeEventListener('keydown', onKey);
      $('btn-intro-skip').removeEventListener('click', finish);
      video.pause();
      root.classList.add('out');
      setTimeout(() => {
        root.classList.add('hidden');
        root.classList.remove('out', 'final');
        running = null;
        resolve();
      }, 450);
    };
    const onKey = (e) => { if (['Escape', 'Enter', 'Space'].includes(e.code)) { e.preventDefault(); finish(); } };

    const type = (lines) => {
      clearInterval(typeTimer);
      const full = lines.join('\n');
      let i = 0;
      text.textContent = '';
      typeTimer = setInterval(() => {
        i += 1;
        text.textContent = full.slice(0, i);
        if (i % 2 && full[i - 1] !== ' ') sfx.type();
        if (i >= full.length) clearInterval(typeTimer);
      }, 32);
    };

    const show = (k) => {
      const b = BEATS[k];
      tag.textContent = b.tag;
      tag.className = `intro-tag ${b.role || ''}`;
      img.src = `assets/img/${b.id}.jpg`;
      img.classList.remove('kb'); void img.offsetWidth; img.classList.add('kb');
      video.classList.remove('on');
      video.src = `assets/video/${b.id}.mp4`;
      video.playbackRate = 0.95;
      video.play().then(() => video.classList.add('on')).catch(() => { /* 영상이 없으면 사진(켄 번즈)만 */ });
      type(b.lines);
      if (b.sound === 'siren') sfx.siren(3);
      else sfx.heartbeat(0.5);
    };

    root.classList.remove('hidden', 'final', 'out');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;
    const total = BEATS.length * BEAT_MS + FINAL_MS;
    bar.style.transition = `width ${total}ms linear`;
    bar.style.width = '100%';
    $('btn-intro-skip').addEventListener('click', finish);
    window.addEventListener('keydown', onKey);
    sfx.ensure();
    sfx.slam();

    BEATS.forEach((_, k) => timers.push(setTimeout(() => show(k), k * BEAT_MS)));
    timers.push(setTimeout(() => {
      root.classList.add('final');
      video.pause();
      tag.textContent = '';
      type([FINAL]);
      sfx.groan(0.5);
    }, BEATS.length * BEAT_MS));
    timers.push(setTimeout(finish, total));
  });
  return running;
}
