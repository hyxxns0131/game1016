// 좀비 AI — 방장(host) 클라이언트만 실행한다. 결과는 broadcast로 상대에게 전달.
import { TILE, PLAYER, ZOMBIE } from './config.js';

const ST = { spawn: 0, wander: 1, chase: 2, investigate: 3 };
export const STATE_CODE = ST;

export class ZombieSim {
  constructor(map, rng, hooks) {
    this.map = map;
    this.rng = rng;
    this.hooks = hooks; // { onDoorBroken(door), onSpawn(z) }
    this.list = [];
    this.nextId = 1;
    this.spawnTimer = 0;
    this.fieldCache = new Map();
  }

  /** 목표 타일 기준 거리장(캐시) */
  field(tx, ty, kind, maxAge = 0.4) {
    const key = `${tx},${ty},${kind}`;
    const c = this.fieldCache.get(key);
    const now = performance.now() / 1000;
    if (c && now - c.t < maxAge && c.ver === this.doorVersion) return c.f;
    const f = this.map.bfs(tx, ty, kind);
    this.fieldCache.set(key, { f, t: now, ver: this.doorVersion });
    if (this.fieldCache.size > 300) this.fieldCache.clear();
    return f;
  }

  get doorVersion() {
    return this.map.doors.reduce((s, d) => s + (d.locked ? 1 : 0) * (d.id + 1) * 7 + (d.broken ? 1 : 0) * (d.id + 1) * 131, 0);
  }

  spawn(phase, players, brute) {
    const far = this.map.vents.filter((v) => players.every((p) => Math.hypot(p.x - v.x, p.y - v.y) > 260));
    const pool = far.length ? far : this.map.vents;
    const v = pool[Math.floor(this.rng() * pool.length)];
    const z = {
      id: this.nextId++, type: brute ? 1 : 0, x: v.x, y: v.y, angle: this.rng() * Math.PI * 2,
      state: ST.spawn, spawnT: 1.2, target: null, tfield: null, retarget: 0, chase: null,
      lastSeen: null, lostT: 0, breakT: 0, senseT: this.rng() * 0.2, leader: null,
    };
    if (phase.group && !brute && this.rng() < 0.65) {
      const leaders = this.list.filter((o) => o.type === 0 && !o.leader);
      if (leaders.length) z.leader = leaders[Math.floor(this.rng() * leaders.length)].id;
    }
    this.list.push(z);
    this.hooks.onSpawn?.(z);
  }

  /** 소리: 반경 안의 좀비가 조사하러 온다 */
  noise(x, y, r, phase) {
    const rr = r * phase.hearingMul;
    for (const z of this.list) {
      if (z.state === ST.spawn || z.state === ST.chase) continue;
      if (Math.hypot(z.x - x, z.y - y) < rr) {
        z.state = ST.investigate;
        z.target = { x, y };
        z.tfield = this.field(this.map.tileOf(x), this.map.tileOf(y), z.type ? 'brute' : 'zombie', 2);
        z.retarget = 9;
      }
    }
  }

  update(dt, phase, players) {
    // 스폰
    const walkers = this.list.filter((z) => z.type === 0).length;
    const brutes = this.list.length - walkers;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (brutes < phase.brutes) { this.spawn(phase, players, true); this.spawnTimer = ZOMBIE.spawnInterval; }
      else if (walkers < phase.count) { this.spawn(phase, players, false); this.spawnTimer = ZOMBIE.spawnInterval; }
    }

    const base = PLAYER.walkSpeed * phase.speedMul;
    const visible = players.filter((p) => !p.hidden && !p.dead);

    for (const z of this.list) {
      const kind = z.type ? 'brute' : 'zombie';
      if (z.state === ST.spawn) {
        z.spawnT -= dt;
        if (z.spawnT <= 0) { z.state = ST.wander; z.retarget = 0; }
        continue;
      }

      // 감지
      z.senseT -= dt;
      if (z.senseT <= 0) {
        z.senseT = 0.2;
        let best = null, bd = Infinity;
        for (const p of visible) {
          const d = Math.hypot(p.x - z.x, p.y - z.y);
          const range = phase.detect * (p.running ? 1.25 : p.crouching ? PLAYER.crouchDetectMul : 1);
          if (d < range && d < bd && this.map.los(z.x, z.y, p.x, p.y)) { best = p; bd = d; }
        }
        if (best) {
          z.state = ST.chase; z.chase = best.userId; z.lostT = 0; z.lastSeen = { x: best.x, y: best.y };
        } else if (z.state === ST.chase) {
          const p = players.find((q) => q.userId === z.chase);
          z.lostT += 0.2;
          if (!p || p.hidden || p.dead || z.lostT > ZOMBIE.loseSightTime) {
            z.state = ST.investigate;
            z.target = z.lastSeen || { x: z.x, y: z.y };
            z.tfield = this.field(this.map.tileOf(z.target.x), this.map.tileOf(z.target.y), kind, 2);
            z.retarget = 6;
            z.chase = null;
          }
        }
      }

      let speed, aimField, aimPoint;
      if (z.state === ST.chase) {
        const p = players.find((q) => q.userId === z.chase);
        if (p && !p.hidden) {
          if (z.lostT === 0) z.lastSeen = { x: p.x, y: p.y };
          aimPoint = z.lostT === 0 ? { x: p.x, y: p.y } : z.lastSeen;
          aimField = this.field(this.map.tileOf(aimPoint.x), this.map.tileOf(aimPoint.y), kind, 0.35);
        }
        speed = base * (z.type ? ZOMBIE.bruteSpeedMul : 1);
      } else if (z.state === ST.investigate) {
        z.retarget -= dt;
        aimPoint = z.target; aimField = z.tfield;
        speed = base * 0.9 * (z.type ? ZOMBIE.bruteSpeedMul : 1);
        if (z.retarget <= 0 || Math.hypot(z.x - z.target.x, z.y - z.target.y) < 20) { z.state = ST.wander; z.retarget = 0; }
      } else {
        z.retarget -= dt;
        const leader = z.leader && this.list.find((o) => o.id === z.leader);
        if (z.retarget <= 0) {
          let t;
          if (leader && phase.group) {
            t = this.map.randomFloorNear(this.rng, this.map.tileOf(leader.x), this.map.tileOf(leader.y), 1);
            z.retarget = 1.5;
          } else {
            t = this.map.randomFloorNear(this.rng, this.map.tileOf(z.x), this.map.tileOf(z.y), 9);
            z.retarget = 4 + this.rng() * 5;
          }
          z.target = this.map.center(t.tx, t.ty);
          z.tfield = this.field(t.tx, t.ty, kind, 3);
        }
        aimPoint = z.target; aimField = z.tfield;
        speed = base * phase.wanderMul * (z.type ? ZOMBIE.bruteSpeedMul : 1);
      }

      if (!aimPoint) continue;
      const dir = this.steer(z, aimField, aimPoint);

      // 서로 겹치지 않게
      for (const o of this.list) {
        if (o === z) continue;
        const dx = z.x - o.x, dy = z.y - o.y, d = Math.hypot(dx, dy);
        if (d > 0 && d < 22) { dir.x += (dx / d) * 0.6; dir.y += (dy / d) * 0.6; }
      }
      const len = Math.hypot(dir.x, dir.y);
      if (len < 0.01) continue;
      const vx = (dir.x / len) * speed * dt, vy = (dir.y / len) * speed * dt;
      const r = z.type ? ZOMBIE.radius + 3 : ZOMBIE.radius;
      const res = this.map.move(z.x, z.y, vx, vy, r, kind);
      z.x = res.x; z.y = res.y;
      const targetAngle = Math.atan2(vy, vx);
      z.angle = lerpAngle(z.angle, targetAngle, Math.min(1, dt * 6));

      if (res.blockedDoor && z.type === 1 && res.blockedDoor.locked && !res.blockedDoor.broken) {
        z.breakT += dt;
        if (z.breakT >= ZOMBIE.bruteDoorBreakTime) {
          res.blockedDoor.broken = true;
          res.blockedDoor.locked = false;
          z.breakT = 0;
          this.hooks.onDoorBroken?.(res.blockedDoor);
        }
      } else if (res.blockedDoor && z.type === 0) {
        z.retarget = 0; // 잠긴 문에 막히면 다른 길
      } else {
        z.breakT = Math.max(0, z.breakT - dt);
      }
    }
  }

  steer(z, field, aim) {
    const m = this.map;
    const tx = m.tileOf(z.x), ty = m.tileOf(z.y);
    const direct = { x: aim.x - z.x, y: aim.y - z.y };
    if (!field) return direct;
    const cur = field[ty * m.w + tx];
    if (cur <= 1) return direct;
    if (cur < 0) return direct;
    // 가까우면서 시야가 트이면 직진
    if (cur < 6 && m.los(z.x, z.y, aim.x, aim.y)) return direct;
    let best = null, bv = cur;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of nb) {
      const v = field[(ty + dy) * m.w + (tx + dx)];
      if (v >= 0 && v < bv) { bv = v; best = [tx + dx, ty + dy]; }
    }
    if (!best) return direct;
    // 다음 칸의 다음 칸까지 보며 부드럽게
    const c = m.center(best[0], best[1]);
    return { x: c.x - z.x, y: c.y - z.y };
  }

  serialize() {
    const out = [];
    for (const z of this.list) out.push(z.id, Math.round(z.x), Math.round(z.y), Math.round(z.angle * 100), z.type, z.state);
    return out;
  }
}

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const TILE_SIZE = TILE;
