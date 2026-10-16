import { TILE } from './config.js';

// 감옥 맵 (64 x 40 타일) — 감방 입구 2칸, 문 3칸, 복도 3칸 폭
// # 벽  . 바닥  , 운동장(풀)  D 문  G 정문(탈출구)  L 사물함  V 하수구/환풍구(좀비 스폰)
// T 탁자/책상  b 침대  P 죄수 시작  W 교도관 시작  K 열쇠 조각 후보 위치
export const MAP_ROWS = [
  '################################################################',
  '#b...#b...#b...#b...#####L...................L#,,,,,,,,,,,,,,,,#',
  '#....#....#..K.#....#####.....................#,,,,,,,,,,,,,,,,#',
  '#.P..#....#....#....#####...TT...TT...TT...K..#,,V,,,,,,,,,,,,,#',
  '#....#....#....#....#####.....................#,,,,,,,,,,,,K,,,#',
  '##..###..###..###..######.....................#,,,,,,,,,,,,,,,,#',
  '#.......................D...TT...TT...TT......D,,,,,,,,,,,,,,,,#',
  '#...........V...........D.....................D,,,,,,,,,,,,,,,,#',
  '#.......................D.....................D,,,,,,,,,,,,,,,,#',
  '##..###..###..###..##...#...TT...TT...TT......#,,,,,,##,,,,,,,,#',
  '#....#....#....#...L#...#.....................#,,,,,,##,,,,,,,,#',
  '#....#....#....#....#...#..K..................#,,,,,,,,,,,,,,,,#',
  '#....#..K.#....#....#...#...TT...TT...TT......#,,,,,,,,,,,V,,,,#',
  '#b...#b...#b...#b...#...#.....................#,,,,,,,,,,,,,,,,#',
  '#####################...#.V...................#,,,,,,,,,,,##,,,#',
  '#####################DDD#.....................#,,,,,,,,,,,##,,,#',
  '#####################...##########...##########,,,,,,,,,,,,,,,,#',
  '#####################...##########DDD##########,,,,,,,,,,,,,,,,#',
  '#.............................................D,,,,,,,,,,,,,,,,G',
  '#.......................................V.....D,,,,,,,,,,,,,,,,G',
  '#...............L.............................D,,,,,,,,,,,,,,,,G',
  '#########...##################...##############,,,,,,,,,,,,,,,,#',
  '#########DDD##################...##############,,,,,,,,,,,,,,,,#',
  '#.....................########...##############,,,,,,,,,,,,,,,,#',
  '#.L...L...L...........########DDD##############,,##,K,,,,,,,,,,#',
  '#.....................###..............#......#,,##,,,,,,,,,,,,#',
  '#.....................###..............#....K.#,,,,,,,,,,,,,,,,#',
  '#..K...............K..###..............#......D,,,,,,,,,,,,,,,,#',
  '#.....................###..TTT....TTT..#......D,,,,,,,,,,,,,,,,#',
  '#.....................###..............#.TTT..D,,,,,,##,,,,,,,,#',
  '#############.........###..............#......#,,,,,,##,,,,,,,,#',
  '#.....................###..............#......#,,,,,,,,,,,,,,,,#',
  '#.....................###.......W......D......#,,,,,,,,,,,,,,,,#',
  '#.....................###..............D.TT...#,,,,,,,,,,,,,V,,#',
  '#................V....###..TT..........D......#,,,,,,,,,,,,,,,,#',
  '#.....................###..............#......#,,,,,,,,,,,,,K,,#',
  '#..K....V.............###..............#...V..#,,,,,,,,,,,,,,,,#',
  '#.....................###............K.#......#,,,,,,,,,,,,,,,,#',
  '#.....................###.............L#.....L#,,,,,,,,,,,,,,,L#',
  '################################################################',
];

// 구역 이름(미니 안내용)
export const ZONES = [
  { name: '감방 구역', x1: 1, y1: 1, x2: 23, y2: 14 },
  { name: '식당', x1: 25, y1: 1, x2: 45, y2: 17 },
  { name: '중앙 복도', x1: 1, y1: 18, x2: 45, y2: 20 },
  { name: '세탁·샤워실', x1: 1, y1: 21, x2: 21, y2: 38 },
  { name: '경비실', x1: 25, y1: 21, x2: 38, y2: 38 },
  { name: '창고', x1: 40, y1: 25, x2: 45, y2: 38 },
  { name: '운동장', x1: 47, y1: 1, x2: 62, y2: 38 },
];
export const YARD_DOOR_X = 46; // 운동장으로 들어가는 문들의 x 타일

const STATIC_SOLID = new Set(['#', 'T', 'b', 'L', 'G']);
const LIGHT_BLOCK = new Set(['#', 'G']);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class GameMap {
  constructor() {
    this.w = MAP_ROWS[0].length;
    this.h = MAP_ROWS.length;
    this.pw = this.w * TILE;
    this.ph = this.h * TILE;
    this.tiles = MAP_ROWS.map((r) => r.split(''));
    this.doors = [];
    this.doorIdAt = new Int16Array(this.w * this.h).fill(-1);
    this.lockers = [];
    this.vents = [];
    this.keySpots = [];
    this.gateTiles = [];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ch = this.tiles[y][x];
        const c = this.center(x, y);
        if (ch === 'P') { this.prisonerSpawn = c; this.tiles[y][x] = '.'; }
        else if (ch === 'W') { this.guardSpawn = c; this.tiles[y][x] = '.'; }
        else if (ch === 'K') { this.keySpots.push(c); this.tiles[y][x] = this.floorAround(x, y); }
        else if (ch === 'V') { this.vents.push({ tx: x, ty: y, ...c }); this.tiles[y][x] = this.floorAround(x, y); }
        else if (ch === 'L') this.lockers.push({ id: this.lockers.length, tx: x, ty: y, ...c });
        else if (ch === 'G') this.gateTiles.push({ tx: x, ty: y, ...c });
        else if (ch === 'D' && this.doorIdAt[y * this.w + x] < 0) this.buildDoor(x, y);
      }
    }
    const g = this.gateTiles;
    this.gateCenter = { x: g[0].x, y: (g[0].y + g[g.length - 1].y) / 2 };
  }

  floorAround(x, y) {
    // 특수 타일 자리의 바닥 종류를 주변으로부터 추정
    const n = [this.tiles[y][x - 1], this.tiles[y][x + 1], this.tiles[y - 1]?.[x], this.tiles[y + 1]?.[x]];
    return n.includes(',') ? ',' : '.';
  }

  buildDoor(x, y) {
    const tiles = [{ tx: x, ty: y }];
    let horizontal = this.tiles[y][x + 1] === 'D';
    if (horizontal) for (let i = x + 1; this.tiles[y][i] === 'D'; i++) tiles.push({ tx: i, ty: y });
    else for (let j = y + 1; this.tiles[j]?.[x] === 'D'; j++) tiles.push({ tx: x, ty: j });
    const id = this.doors.length;
    tiles.forEach((t) => (this.doorIdAt[t.ty * this.w + t.tx] = id));
    const xs = tiles.map((t) => t.tx), ys = tiles.map((t) => t.ty);
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE;
    const cy = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * TILE;
    // horizontal = 문짝이 가로로 놓임(위아래로 통과)
    this.doors.push({ id, tiles, horizontal, x: cx, y: cy, locked: false, broken: false, open: 0, lockedAt: 0 });
  }

  center(tx, ty) { return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }; }
  tileOf(px) { return Math.floor(px / TILE); }
  ch(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? '#' : this.tiles[ty][tx]; }
  doorAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return null;
    const id = this.doorIdAt[ty * this.w + tx];
    return id >= 0 ? this.doors[id] : null;
  }

  /** kind: 'prisoner' | 'guard' | 'zombie' | 'brute' */
  blocked(tx, ty, kind) {
    const c = this.ch(tx, ty);
    // 점프 중('air' / 'guard-air')엔 탁자·침대를 넘는다
    if ((kind === 'air' || kind === 'guard-air') && (c === 'T' || c === 'b')) return false;
    if (STATIC_SOLID.has(c)) return true;
    if (c === 'D') {
      const d = this.doorAt(tx, ty);
      if (d.locked && !d.broken && kind !== 'guard' && kind !== 'guard-air') return true;
    }
    return false;
  }

  /** BFS 경로탐색용 통과 판정. brute는 잠긴 문을 '부술 수 있는 길'로 본다. */
  passable(tx, ty, kind) {
    if (kind === 'brute') return !STATIC_SOLID.has(this.ch(tx, ty));
    return !this.blocked(tx, ty, kind);
  }

  /** 원형 몸체 이동(축 분리 충돌). 막힌 문이 있으면 blockedDoor로 알려준다 */
  move(x, y, dx, dy, r, kind) {
    let blockedDoor = null;
    const test = (nx, ny) => {
      const x0 = this.tileOf(nx - r), x1 = this.tileOf(nx + r);
      const y0 = this.tileOf(ny - r), y1 = this.tileOf(ny + r);
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++)
          if (this.blocked(tx, ty, kind)) {
            if (this.ch(tx, ty) === 'D') blockedDoor = this.doorAt(tx, ty);
            return true;
          }
      return false;
    };
    let nx = x + dx;
    if (test(nx, y)) {
      // 벽에 바짝 붙도록 절반씩 시도
      nx = x + dx * 0.5;
      if (test(nx, y)) nx = x;
    }
    let ny = y + dy;
    if (test(nx, ny)) {
      ny = y + dy * 0.5;
      if (test(nx, ny)) ny = y;
    }
    return { x: nx, y: ny, blockedDoor };
  }

  lightBlocked(px, py) {
    return LIGHT_BLOCK.has(this.ch(this.tileOf(px), this.tileOf(py)));
  }

  /** 빛 광선: 벽까지의 거리 */
  castRay(x, y, ang, max) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const step = 6;
    for (let d = step; d < max; d += step) {
      if (this.lightBlocked(x + cs * d, y + sn * d)) return d;
    }
    return max;
  }

  /** 시야(line of sight) */
  los(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.lightBlocked(x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  }

  /** 목표 타일로부터의 거리장(flow field) */
  bfs(tx, ty, kind) {
    const w = this.w, h = this.h;
    const dist = new Int16Array(w * h).fill(-1);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return dist;
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    dist[ty * w + tx] = 0;
    q[tail++] = ty * w + tx;
    while (head < tail) {
      const i = q[head++];
      const x = i % w, y = (i / w) | 0;
      const nd = dist[i] + 1;
      if (x > 0 && dist[i - 1] < 0 && this.passable(x - 1, y, kind)) { dist[i - 1] = nd; q[tail++] = i - 1; }
      if (x < w - 1 && dist[i + 1] < 0 && this.passable(x + 1, y, kind)) { dist[i + 1] = nd; q[tail++] = i + 1; }
      if (y > 0 && dist[i - w] < 0 && this.passable(x, y - 1, kind)) { dist[i - w] = nd; q[tail++] = i - w; }
      if (y < h - 1 && dist[i + w] < 0 && this.passable(x, y + 1, kind)) { dist[i + w] = nd; q[tail++] = i + w; }
    }
    return dist;
  }

  randomFloorNear(rng, tx, ty, radius) {
    for (let i = 0; i < 40; i++) {
      const x = tx + Math.round((rng() * 2 - 1) * radius);
      const y = ty + Math.round((rng() * 2 - 1) * radius);
      const c = this.ch(x, y);
      if (c === '.' || c === ',') return { tx: x, ty: y };
    }
    return { tx, ty };
  }

  zoneName(px, py) {
    const tx = this.tileOf(px), ty = this.tileOf(py);
    const z = ZONES.find((z) => tx >= z.x1 && tx <= z.x2 && ty >= z.y1 && ty <= z.y2);
    return z ? z.name : '';
  }
}
