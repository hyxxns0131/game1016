// AI 교도관 — 혼자 하기 모드에서 교도관을 대신 조종한다.
// 순찰(남은 열쇠·정문·복도) → 죄수 발견 시 추격 → 놓치면 마지막 위치 수색.
// 소리를 들으면 확인하러 가고, 좀비는 피하며, 죄수가 열쇠를 모으면 운동장 문을 잠근다.
import { PLAYER, GUARD, AI_GUARD } from './config.js';
import { lerpAngle } from './zombies.js';
import { YARD_DOOR_X } from './map.js';

const PATROL_TILES = [[10, 19], [32, 19], [22, 12], [35, 8], [53, 6], [53, 19], [56, 32], [10, 27], [31, 30], [43, 31], [6, 7], [11, 34]];

export class GuardAI {
  constructor(scene, guard) {
    this.s = scene;
    this.g = guard;
    this.mode = 'patrol';
    this.target = null;
    this.field = null;
    this.fieldTile = '';
    this.lastSeen = null;
    this.lostT = 0;
    this.searchT = 0;
    this.waitT = 0;
    this.thinkT = 0;
    this.repathT = 0;
  }

  get map() { return this.s.map; }

  setTarget(x, y) {
    this.target = { x, y };
    this.repathT = 0;
  }

  path() {
    const m = this.map;
    const tx = m.tileOf(this.target.x), ty = m.tileOf(this.target.y);
    const key = `${tx},${ty}`;
    this.repathT -= 1;
    if (key !== this.fieldTile || this.repathT <= 0) {
      this.field = m.bfs(tx, ty, 'guard');
      this.fieldTile = key;
      this.repathT = 20;
    }
  }

  pickPatrol() {
    const s = this.s, pr = s.prisoner, m = this.map;
    const opts = [];
    s.keys.filter((k) => !k.taken).forEach((k) => opts.push({ x: k.x, y: k.y, w: 2 }));
    opts.push({ x: m.gateCenter.x - 90, y: m.gateCenter.y, w: 1 + pr.keys * 2.5 });
    PATROL_TILES.forEach(([tx, ty]) => opts.push({ ...m.center(tx, ty), w: 1 }));
    const far = opts.filter((o) => Math.hypot(o.x - this.g.x, o.y - this.g.y) > 120);
    const list = far.length ? far : opts;
    let r = Math.random() * list.reduce((a, o) => a + o.w, 0);
    for (const o of list) { r -= o.w; if (r <= 0) return this.setTarget(o.x, o.y); }
    this.setTarget(list[0].x, list[0].y);
  }

  /** 소리(죄수의 달리기/문/착지) */
  hear(x, y, r) {
    const g = this.g;
    const d = Math.hypot(x - g.x, y - g.y);
    if (d < 40 || this.mode === 'chase') return;
    if (d < r * AI_GUARD.hearingMul) {
      this.mode = 'search';
      this.searchT = 7;
      this.setTarget(x, y);
    }
  }

  think() {
    const s = this.s, g = this.g, pr = s.prisoner;
    if (s.canSee(g, pr) || (Math.hypot(pr.x - g.x, pr.y - g.y) < 60 && !pr.hidden)) {
      if (this.mode !== 'chase') s.toast('🔦 AI 교도관이 당신을 발견했다!');
      this.mode = 'chase';
      this.lastSeen = { x: pr.x, y: pr.y };
      this.lostT = 0;
    } else if (this.mode === 'chase') {
      this.lostT += 0.15;
      if (this.lostT > AI_GUARD.memory) {
        this.mode = 'search';
        this.searchT = 6;
        this.setTarget(this.lastSeen.x, this.lastSeen.y);
      }
    }
    // 운동장 문 잠그기 (죄수가 열쇠를 모았을 때)
    if (pr.keys >= 1 && g.lockCd <= 0) {
      const d = s.nearestDoor(g, 70);
      const lockedCount = this.map.doors.filter((x) => x.locked).length;
      const yardDoor = d && d.tiles[0].tx === YARD_DOOR_X;
      if (d && yardDoor && !d.locked && !d.broken && lockedCount < GUARD.maxLocks && !s.doorOccupied(d)) s.lockDoor(g, d);
    }
  }

  steer(aim) {
    const m = this.map, g = this.g;
    const direct = { x: aim.x - g.x, y: aim.y - g.y };
    if (m.los(g.x, g.y, aim.x, aim.y) && Math.hypot(direct.x, direct.y) < 200) return direct;
    this.path();
    const f = this.field;
    const tx = m.tileOf(g.x), ty = m.tileOf(g.y);
    const cur = f[ty * m.w + tx];
    if (cur <= 0) return direct;
    let best = null, bv = cur;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = f[(ty + dy) * m.w + (tx + dx)];
      if (v >= 0 && v < bv) { bv = v; best = [tx + dx, ty + dy]; }
    }
    if (!best) return direct;
    const c = m.center(best[0], best[1]);
    return { x: c.x - g.x, y: c.y - g.y };
  }

  update(dt) {
    const s = this.s, g = this.g, pr = s.prisoner;
    g.lockCd = Math.max(0, g.lockCd - dt);
    g.arrestCd = Math.max(0, g.arrestCd - dt);

    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.15; this.think(); }

    // 목표 정하기
    let aim;
    if (this.mode === 'chase') {
      aim = pr.hidden ? this.lastSeen : { x: pr.x, y: pr.y };
      this.setTarget(aim.x, aim.y);
    } else {
      if (this.mode === 'search') {
        this.searchT -= dt;
        if (this.searchT <= 0) { this.mode = 'patrol'; this.target = null; }
      }
      if (!this.target) this.pickPatrol();
      aim = this.target;
      if (Math.hypot(aim.x - g.x, aim.y - g.y) < 22) {
        // 도착: 잠깐 두리번거린 뒤 다음 지점
        if (this.waitT <= 0) this.waitT = 1 + Math.random() * 1.5;
        this.waitT -= dt;
        g.angle += dt * 2.2;
        g.moving = false; g.running = false;
        g.stamina = Math.min(PLAYER.stamina, g.stamina + PLAYER.staminaRegen * dt);
        if (this.waitT <= 0) { this.mode = 'patrol'; this.target = null; }
        return;
      }
    }

    const dir = this.steer(aim);
    let len = Math.hypot(dir.x, dir.y) || 1;
    dir.x /= len; dir.y /= len;

    // 좀비 회피
    let danger = false;
    for (const z of s.zombiePositions()) {
      if (z.state === 0) continue;
      const dx = g.x - z.x, dy = g.y - z.y, d = Math.hypot(dx, dy);
      if (d < AI_GUARD.zombieAvoid && d > 0) {
        const w = ((AI_GUARD.zombieAvoid - d) / AI_GUARD.zombieAvoid) * 2.2;
        dir.x += (dx / d) * w; dir.y += (dy / d) * w;
        if (d < AI_GUARD.zombieAvoid * 0.7) danger = true;
      }
    }
    len = Math.hypot(dir.x, dir.y) || 1;

    // 달리기 판단
    if (g.exhausted && g.stamina >= PLAYER.staminaMinToRun) g.exhausted = false;
    g.running = (this.mode === 'chase' || danger) && !g.exhausted && g.stamina > 0;
    if (g.running) {
      g.stamina -= PLAYER.staminaDrain * dt;
      if (g.stamina <= 0) { g.stamina = 0; g.exhausted = true; g.running = false; }
    } else {
      g.stamina = Math.min(PLAYER.stamina, g.stamina + PLAYER.staminaRegen * dt * 0.6);
    }

    const sp = (g.running ? PLAYER.runSpeed : PLAYER.walkSpeed) * AI_GUARD.speedMul;
    const res = this.map.move(g.x, g.y, (dir.x / len) * sp * dt, (dir.y / len) * sp * dt, PLAYER.radius, 'guard');
    const moved = Math.hypot(res.x - g.x, res.y - g.y);
    g.x = res.x; g.y = res.y;
    g.moving = moved > 0.1;
    if (moved < 0.05 && this.mode !== 'chase') this.target = null; // 막히면 다른 곳으로

    // 손전등 방향: 추격 중엔 죄수를, 아니면 진행 방향을 비춘다
    const look = this.mode === 'chase' && !pr.hidden ? Math.atan2(pr.y - g.y, pr.x - g.x) : Math.atan2(dir.y, dir.x);
    g.angle = lerpAngle(g.angle, look, Math.min(1, dt * 8));
  }
}
