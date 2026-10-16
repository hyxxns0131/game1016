// DOM 화면/HUD 헬퍼
import { PLAYER, PRISONER, GUARD } from './config.js';

export const $ = (id) => document.getElementById(id);

export function showScreen(id) {
  ['screen-lobby', 'screen-reveal', 'screen-result'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}

export function hideAllScreens() { showScreen(null); }

let toastTimer;
export function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

const fmt = (s) => {
  s = Math.ceil(s);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const hud = {
  cards: [],
  show() { $('hud').classList.remove('hidden'); },
  hide() { $('hud').classList.add('hidden'); $('hud-hint').classList.add('hidden'); },

  setupCards(players, mode) {
    const left = $('hud-left');
    left.innerHTML = '';
    this.cards = players.map((p) => {
      const el = document.createElement('div');
      el.className = 'pcard';
      const ctrl = p.slot === 'p2'
        ? 'WASD · Shift 달리기 · R 점프 · F 앉기 · E 행동'
        : '방향키 · Space 점프 · Z 앉기 · X 달리기 · C 행동';
      el.innerHTML = `
        <div class="who">
          <img src="assets/img/portrait_${p.role}.jpg" alt="" />
          <div><div class="name"></div><div class="role ${p.role}">${p.role === 'prisoner' ? '죄수 — 탈출하라' : '교도관 — 막아라'}</div></div>
        </div>
        <div class="stat"><span>${p.role === 'prisoner' ? '열쇠 조각' : '잠근 문'}</span><span class="v"></span></div>
        <div class="stat"><span>스태미나</span><span class="st"></span></div>
        <div class="bar"><i></i></div>
        <div class="ctrl">${ctrl}</div>`;
      el.querySelector('.name').textContent = p.nickname;
      left.appendChild(el);
      return { p, el, v: el.querySelector('.v'), st: el.querySelector('.st'), bar: el.querySelector('.bar'), fill: el.querySelector('.bar > i') };
    });
  },

  update({ remaining, phase, phaseIdx, scene }) {
    $('hud-time').textContent = fmt(remaining);
    $('hud-time').style.color = remaining < 60 ? '#ff4a30' : '';
    $('hud-phase').textContent = phase.name;
    $('hud-phase-box').className = `hud-box hud-phase p${phaseIdx}`;

    const hints = [];
    for (const c of this.cards) {
      const p = c.p;
      if (p.role === 'prisoner') {
        c.v.innerHTML = `<span class="keys">${Array.from({ length: PRISONER.keysNeeded }, (_, i) => `<span class="${i < p.keys ? 'on' : ''}"></span>`).join('')}</span>`;
      } else {
        const locked = scene.map.doors.filter((d) => d.locked).length;
        c.v.textContent = `${locked} / ${GUARD.maxLocks}${p.lockCd > 0 ? ` (재충전 ${Math.ceil(p.lockCd)}s)` : ''}`;
      }
      const st = p.hidden ? `숨는 중 ${Math.ceil(PRISONER.hideMax - p.hideT)}s` : `${p.crouching ? '앉음 · ' : ''}${Math.round(p.stamina)}`;
      c.st.textContent = st;
      c.fill.style.width = `${(p.stamina / PLAYER.stamina) * 100}%`;
      c.bar.classList.toggle('low', p.exhausted);

      const prefix = this.cards.length > 1 ? `[${p.role === 'prisoner' ? '죄수' : '교도관'}] ` : '';
      const key = p.slot === 'p2' ? 'E' : 'C';
      if (p.role === 'prisoner') {
        if (p.hidden) hints.push(`${prefix}[${key}] 사물함에서 나가기`);
        else if (scene.nearestLocker(p)) hints.push(`${prefix}[${key}] 사물함에 숨기 (최대 ${PRISONER.hideMax}초)`);
        const gd = Math.hypot(scene.map.gateCenter.x - p.x, scene.map.gateCenter.y - p.y);
        if (gd < 120 && p.keys < PRISONER.keysNeeded) hints.push(`${prefix}정문: 열쇠 조각 ${p.keys}/${PRISONER.keysNeeded}`);
      } else {
        const d = scene.nearestDoor(p);
        if (d && !d.broken) hints.push(`${prefix}[${key}] 문 ${d.locked ? '잠금 해제' : '잠그기'}`);
      }
    }
    const hint = $('hud-hint');
    hint.textContent = hints.join('   ·   ');
    hint.classList.toggle('hidden', hints.length === 0);
  },

  banner(title, sub) {
    const el = $('hud-banner');
    el.classList.remove('hidden');
    el.innerHTML = '';
    el.textContent = title;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  },

  message(text) {
    const box = $('hud-msg');
    const d = document.createElement('div');
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 3000);
    while (box.children.length > 4) box.firstChild.remove();
  },
};
