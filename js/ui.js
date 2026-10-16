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
        : '방향키/클릭 이동 · Space 점프 · Z 앉기 · X 달리기 · C 행동 · M 지도';
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

// ---------------------------------------------------------------- 미니맵 (오른쪽 위, M 키로 토글)
const MM = 5; // 타일당 픽셀
export const minimap = {
  open: (() => { try { return localStorage.getItem('zpb_minimap') !== '0'; } catch { return true; } })(),
  base: null,

  setup(map) {
    this.map = map;
    const cv = $('minimap-canvas');
    cv.width = map.w * MM;
    cv.height = map.h * MM;
    // 정적인 바닥/벽 레이어를 한 번만 그려 둔다
    const base = document.createElement('canvas');
    base.width = cv.width; base.height = cv.height;
    const c = base.getContext('2d');
    const color = { '#': '#15171a', ',': '#3d3424', '.': '#4a4c4f', 'T': '#2c2f33', 'b': '#2c2f33', 'L': '#3f5a4c', 'G': '#c9a21e', 'D': '#6f777d' };
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      c.fillStyle = color[map.ch(x, y)] || '#4a4c4f';
      c.fillRect(x * MM, y * MM, MM, MM);
    }
    map.vents.forEach((v) => { c.fillStyle = '#5e7a2a'; c.fillRect(v.tx * MM + 1, v.ty * MM + 1, MM - 2, MM - 2); });
    this.base = base;
    this.ctx = cv.getContext('2d');
    $('btn-map').onclick = () => this.toggle();
    this.apply();
  },

  toggle() {
    this.open = !this.open;
    try { localStorage.setItem('zpb_minimap', this.open ? '1' : '0'); } catch { /* 무시 */ }
    this.apply();
  },
  apply() { $('minimap').classList.toggle('closed', !this.open); },

  draw(scene) {
    if (!this.open || !this.base) return;
    const c = this.ctx, m = this.map;
    c.drawImage(this.base, 0, 0);
    const k = MM / 32;
    // 문 상태
    for (const d of m.doors) {
      c.fillStyle = d.broken ? '#222' : d.locked ? '#ff3a28' : '#8a949b';
      d.tiles.forEach((t) => c.fillRect(t.tx * MM, t.ty * MM, MM, MM));
    }
    // 열쇠(죄수만 위치를 안다)
    const viewers = scene.players.filter((p) => p.local);
    if (viewers.some((p) => p.role === 'prisoner')) {
      for (const key of scene.keys) if (!key.taken) {
        c.fillStyle = '#f5c041';
        c.beginPath(); c.arc(key.x * k, key.y * k, 3, 0, Math.PI * 2); c.fill();
      }
    }
    // 정문 깜빡임
    if (Math.floor(performance.now() / 500) % 2) {
      c.strokeStyle = '#ffd23a'; c.lineWidth = 1.5;
      c.strokeRect(m.gateTiles[0].tx * MM - 2, m.gateTiles[0].ty * MM - 2, MM + 4, m.gateTiles.length * MM + 4);
    }
    // 나(와 로컬 플레이어)
    for (const p of viewers) {
      const x = p.x * k, y = p.y * k;
      c.fillStyle = p.role === 'prisoner' ? '#ff8a2a' : '#7fb0ff';
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(p.angle) * 8, y + Math.sin(p.angle) * 8); c.stroke();
      if (p.moveTarget) {
        c.strokeStyle = 'rgba(255,210,122,.8)';
        c.beginPath(); c.arc(p.moveTarget.x * k, p.moveTarget.y * k, 3, 0, Math.PI * 2); c.stroke();
      }
    }
    const me = viewers[0];
    if (me) $('minimap-zone').textContent = `📍 ${m.zoneName(me.x, me.y) || '—'}`;
  },
};
