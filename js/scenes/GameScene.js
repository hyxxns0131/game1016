import { TILE, GAME, PLAYER, PRISONER, GUARD, PHASES, ZOMBIE } from '../config.js';
import { GameMap, mulberry32, hashString } from '../map.js';
import { buildMapTexture } from '../render.js';
import { ZombieSim, lerpAngle } from '../zombies.js';
import { GuardAI } from '../guardAI.js';
import { sfx } from '../audio.js';
import { hud, minimap } from '../ui.js';

// 방향키 이동 · Space 점프 · Z 앉기 · X 달리기 · C 행동
const CONTROLS = {
  online: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], run: ['KeyX'], act: ['KeyC'], jump: ['Space'], crouch: ['KeyZ'] },
  // 개발용 로컬 테스트(?autostart=local)에서 두 번째 플레이어
  p2: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], run: ['ShiftLeft'], act: ['KeyE'], jump: ['KeyR'], crouch: ['KeyF'] },
};
const ROLE_KO = { prisoner: '죄수', guard: '교도관' };
const NO_FOG = new URLSearchParams(location.search).has('nofog'); // 디버그용
const DEBUG_FOLLOW = new URLSearchParams(location.search).has('follow'); // 디버그용: 온라인 시점 미리보기
const SPRITE_H ={ prisoner: 54, guard: 56, zombie: 56, brute: 76 };

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.net = data.net;
    this.onGameOver = data.onGameOver;
  }

  create() {
    const net = this.net;
    this.map = new GameMap();
    this.rng = mulberry32(hashString(net.room.id + ':' + net.room.round));
    this.startedAt = net.startedAtMs;
    this.over = false;
    this.phaseIdx = 0;
    this.netT = 0;
    this.zNetT = 0;
    this.hudT = 0;
    this.groanT = 1;
    this.beatT = 0;
    this.offs = [];

    buildMapTexture(this, this.map);
    this.add.image(0, 0, 'map').setOrigin(0).setDepth(0);

    this.setupKeys();
    this.setupDoors();
    this.setupLockers();
    this.setupPlayers();
    this.setupZombies();
    this.setupLights();
    this.setupFx();
    this.setupInput();
    this.setupNet();
    this.setupCamera();

    hud.setupCards(this.players.filter((p) => p.local), net.mode);
    minimap.setup(this.map);
    hud.show();
    sfx.startAmbient();

    this.events.once('shutdown', () => this.cleanup());
  }

  // ---------------------------------------------------------------- 셋업
  setupKeys() {
    const spots = [...this.map.keySpots];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    this.keys = spots.slice(0, PRISONER.keysNeeded).map((s, id) => {
      const glow = this.add.image(s.x, s.y, 'glow').setTint(0xf5c041).setAlpha(0.35).setScale(0.45).setDepth(3).setBlendMode('ADD');
      const sprite = this.add.image(s.x, s.y, 'key').setDisplaySize(26, 30).setDepth(4);
      this.tweens.add({ targets: sprite, angle: { from: -12, to: 12 }, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
      this.tweens.add({ targets: glow, alpha: { from: 0.2, to: 0.5 }, yoyo: true, repeat: -1, duration: 700 });
      return { id, x: s.x, y: s.y, taken: false, sprite, glow };
    });
  }

  setupDoors() {
    this.doorGfx = this.add.graphics().setDepth(6);
    this.map.doors.forEach((d) => { d.isOpen = false; });
  }

  setupLockers() {
    this.lockerSprites = this.map.lockers.map((l) => this.add.image(l.x, l.y, 'locker').setDepth(2));
  }

  makeCharacter(texture, h) {
    const shadow = this.add.image(0, 0, 'shadow').setDepth(9).setAlpha(0.8);
    const img = this.add.image(0, 0, texture).setDepth(10);
    const s = h / img.height;
    img.setScale(s);
    shadow.setDisplaySize(img.displayWidth * 1.1, img.displayWidth * 0.75);
    shadow.scaleX0 = shadow.scaleX; shadow.scaleY0 = shadow.scaleY;
    img.baseScale = s;
    return { img, shadow };
  }

  setupPlayers() {
    const net = this.net;
    const ps = net.players;
    this.players = ['prisoner', 'guard'].map((role) => {
      const u = ps.find((p) => p.role === role);
      const idx = ps.indexOf(u);
      const local = net.mode === 'local' || u.user_id === net.uid;
      const spawn = role === 'prisoner' ? this.map.prisonerSpawn : this.map.guardSpawn;
      const { img, shadow } = this.makeCharacter(role, SPRITE_H[role]);
      return {
        role, userId: u.user_id, nickname: u.nickname, local,
        ai: net.mode === 'solo' && role === 'guard',
        slot: net.mode === 'local' ? (idx === 0 ? 'p1' : 'p2') : 'online',
        controls: net.mode === 'local' && idx === 1 ? CONTROLS.p2 : CONTROLS.online,
        x: spawn.x, y: spawn.y, tx: spawn.x, ty: spawn.y, angle: role === 'prisoner' ? Math.PI / 2 : -Math.PI / 2,
        stamina: PLAYER.stamina, exhausted: false, running: false, moving: false,
        hidden: false, hideT: 0, hideCd: 0, lockerId: -1,
        keys: 0, immuneUntil: 0, lockCd: 0, arrestCd: 0, noiseT: 0, dead: false,
        airT: 0, jumpCd: 0, crouching: false, preJump: null,
        bob: 0, img, shadow,
      };
    });
    this.prisoner = this.players[0];
    this.guard = this.players[1];
    this.me = net.mode === 'local' ? null : this.players.find((p) => p.local);
    this.guardAI = this.guard.ai ? new GuardAI(this, this.guard) : null;
  }

  setupZombies() {
    this.zombieViews = new Map(); // id → view
    this.sim = this.net.isHost
      ? new ZombieSim(this.map, mulberry32(hashString(this.net.room.id + 'z' + this.net.room.round)), {
        onDoorBroken: (door) => {
          this.net.send('doorBroken', { id: door.id });
          this.onDoorBroken(door);
        },
      })
      : null;
  }

  setupLights() {
    this.dark = this.add.renderTexture(0, 0, this.map.pw, this.map.ph).setOrigin(0).setDepth(50);
    this.lightG = this.make.graphics({ x: 0, y: 0 }, false);
    // 비상등(붉은 점멸)
    const lampSpots = [[12, 7], [35, 16], [10, 26], [31, 26], [43, 27], [60, 19], [35, 2], [5, 33], [22, 12]];
    this.lamps = lampSpots.map(([tx, ty], i) => {
      const c = this.map.center(tx, ty);
      const g = this.add.image(c.x, c.y, 'glow').setTint(0xff2a10).setBlendMode('ADD').setDepth(55).setScale(1.6).setAlpha(0.25);
      return { x: c.x, y: c.y, g, phase: i * 1.7, flick: 1 };
    });
  }

  setupFx() {
    this.ash = this.add.particles(0, 0, 'ash', {
      x: { min: 0, max: this.map.pw }, y: { min: -20, max: this.map.ph },
      lifespan: 7000, speedX: { min: -14, max: 6 }, speedY: { min: 8, max: 26 },
      scale: { min: 0.25, max: 0.7 }, alpha: { start: 0.45, end: 0 },
      tint: [0xcfc6b8, 0x9a8f80, 0xff8a50], frequency: 35, quantity: 2,
    }).setDepth(60);
  }

  /** 클릭한 지점까지 경로를 따라가는 방향(도착하면 null) */
  clickDir(p, dt) {
    const t = p.moveTarget, m = this.map;
    const dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy);
    if (dist < 8) return null;
    // 제자리에 막혀 있으면 취소
    t.stuck = Math.hypot(p.x - (t.lx ?? p.x + 99), p.y - (t.ly ?? 0)) < 0.3 ? (t.stuck || 0) + dt : 0;
    t.lx = p.x; t.ly = p.y;
    if (t.stuck > 0.6) return null;
    if (dist < 160 && m.los(p.x, p.y, t.x, t.y)) return { x: dx / dist, y: dy / dist };
    const tx = m.tileOf(p.x), ty = m.tileOf(p.y);
    const f = t.field, cur = f[ty * m.w + tx];
    if (cur <= 0) return { x: dx / dist, y: dy / dist };
    let best = null, bv = cur;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = f[(ty + oy) * m.w + (tx + ox)];
      if (v >= 0 && v < bv) { bv = v; best = m.center(tx + ox, ty + oy); }
    }
    if (!best) return { x: dx / dist, y: dy / dist };
    const bx = best.x - p.x, by = best.y - p.y, bl = Math.hypot(bx, by) || 1;
    return { x: bx / bl, y: by / bl };
  }

  setMoveTarget(wx, wy) {
    const p = this.me || this.players.find((q) => q.local && q.slot !== 'p2');
    if (!p || this.over) return;
    const m = this.map;
    let tx = m.tileOf(wx), ty = m.tileOf(wy);
    // 벽을 찍으면 가장 가까운 바닥으로
    if (m.blocked(tx, ty, p.role)) {
      let best = null, bd = Infinity;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        if (m.blocked(tx + ox, ty + oy, p.role)) continue;
        const d = ox * ox + oy * oy;
        if (d < bd) { bd = d; best = [tx + ox, ty + oy]; }
      }
      if (!best) return;
      [tx, ty] = best;
      const c = m.center(tx, ty); wx = c.x; wy = c.y;
    }
    const key = tx + ',' + ty;
    const field = p.moveTarget && p.moveTarget.key === key ? p.moveTarget.field : m.bfs(tx, ty, p.role);
    p.moveTarget = { x: wx, y: wy, key, field };
    this.clickMark.setPosition(wx, wy).setAlpha(0.9).setScale(0.25);
    this.tweens.add({ targets: this.clickMark, alpha: 0, scale: 0.12, duration: 500 });
  }

  setupInput() {
    this.clickMark = this.add.image(0, 0, 'glow').setTint(0xffd27a).setAlpha(0).setDepth(70).setBlendMode('ADD');
    const onPointer = (ptr) => {
      if (!ptr.isDown) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      this.setMoveTarget(wp.x, wp.y);
    };
    this.input.on('pointerdown', onPointer);
    // 누른 채 끌면 계속 따라간다(너무 자주 경로 계산하지 않게 0.15초 간격)
    let lastDrag = 0;
    this.input.on('pointermove', (ptr) => {
      if (ptr.isDown && performance.now() - lastDrag > 150) { lastDrag = performance.now(); onPointer(ptr); }
    });

    this.down = new Set();
    this.pressed = new Set();
    const kd = (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyM') minimap.toggle();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    const ku = (e) => this.down.delete(e.code);
    const blur = () => this.down.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.offs.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }

  setupNet() {
    const net = this.net;
    if (net.mode !== 'online') return;
    const on = (t, cb) => this.offs.push(net.on(t, cb));
    const remote = this.players.find((p) => !p.local);

    on('p', (d) => {
      remote.tx = d.x; remote.ty = d.y; remote.angle = d.a / 100;
      remote.running = !!d.r; remote.hidden = !!d.h; remote.moving = !!d.m;
      remote.crouching = !!d.c; remote.airT = d.j ? 0.1 : 0;
      if (remote.role === 'prisoner') remote.keys = d.k;
      if (Math.hypot(remote.tx - remote.x, remote.ty - remote.y) > 160) { remote.x = remote.tx; remote.y = remote.ty; }
    });
    on('z', (arr) => this.applyZombies(arr));
    on('noise', (d) => this.sim?.noise(d.x, d.y, d.r, PHASES[this.phaseIdx]));
    on('keys', (list) => this.applyKeys(list));
    on('door', (d) => {
      const door = this.map.doors[d.id];
      if (!door || door.broken) return;
      door.locked = d.locked;
      sfx.lock();
    });
    on('doorBroken', (d) => this.onDoorBroken(this.map.doors[d.id]));
    on('arrest', () => this.onArrested());
    on('arrested', (d) => {
      this.toast(`🚨 ${this.prisoner.nickname}(죄수) 체포! 감방으로 이송${d.dropped ? ' · 열쇠 조각 1개 떨어짐' : ''}`);
    });
    on('over', () => this.fetchOver());
    on('presence-leave', (id) => {
      if (this.over || id !== remote.userId) return;
      setTimeout(() => {
        if (!this.over && !net.opponentOnline()) this.finish('disconnect', this.me.userId);
      }, GAME.DISCONNECT_GRACE_MS);
    });
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.pw, this.map.ph);
    cam.setBackgroundColor('#000');
    const fit = () => {
      const w = this.scale.width, h = this.scale.height;
      if (this.net.mode === 'local' && !DEBUG_FOLLOW) {
        cam.setZoom(Math.min(w / this.map.pw, h / this.map.ph));
        cam.centerOn(this.map.pw / 2, this.map.ph / 2);
      } else {
        cam.setZoom(Phaser.Math.Clamp(Math.min(w / 680, h / 440), 1.3, 2.6));
      }
    };
    fit();
    this.scale.on('resize', fit);
    this.offs.push(() => this.scale.off('resize', fit));
    if (DEBUG_FOLLOW) cam.startFollow(this.prisoner.img, true, 0.12, 0.12);
    if (this.me) {
      cam.startFollow(this.me.img, true, 0.12, 0.12);
      cam.centerOn(this.me.x, this.me.y);
    }
    cam.fadeIn(800);
  }

  cleanup() {
    this.offs.forEach((f) => f());
    this.offs = [];
    sfx.stopAmbient();
    hud.hide();
  }

  // ---------------------------------------------------------------- 루프
  update(time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const elapsed = (this.net.serverNow() - this.startedAt) / 1000;
    const remaining = Math.max(0, GAME.GAME_DURATION - elapsed);
    const frozen = elapsed < 0 || this.over;

    // 단계
    let pi = 0;
    PHASES.forEach((p, i) => { if (elapsed >= p.from) pi = i; });
    if (pi !== this.phaseIdx && !this.over) { this.phaseIdx = pi; this.onPhaseChange(pi); }
    const phase = PHASES[this.phaseIdx];

    for (const p of this.players) {
      if (p.ai) { if (!frozen) this.guardAI.update(dt); }
      else if (p.local && !frozen) this.updateLocal(p, dt);
      else if (!p.local) this.updateRemote(p, dt);
    }

    if (!frozen) {
      if (this.sim) this.sim.update(dt, phase, this.players);
      this.updateDoors(dt);
      this.checkInteractions();
      if (remaining <= 0) this.finish('time', this.guard.userId);
    }
    this.updateZombieViews(dt);
    this.updateCharacters(dt);
    this.drawDoors();
    this.drawLights(time);
    this.ambientSounds(dt);
    this.sendNet(dt);

    this.pressed.clear();

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      hud.update({ remaining, phase, phaseIdx: this.phaseIdx, players: this.players.filter((p) => p.local), scene: this });
      minimap.draw(this);
    }
  }

  isDown(p, action) { return p.controls[action].some((c) => this.down.has(c)); }
  isPressed(p, action) { return p.controls[action].some((c) => this.pressed.has(c)); }

  updateLocal(p, dt) {
    p.hideCd = Math.max(0, p.hideCd - dt);
    p.lockCd = Math.max(0, p.lockCd - dt);
    p.arrestCd = Math.max(0, p.arrestCd - dt);

    if (p.hidden) {
      p.hideT += dt;
      p.stamina = Math.min(PLAYER.stamina, p.stamina + PLAYER.staminaRegen * dt);
      if (p.hideT >= PRISONER.hideMax) { this.unhide(p); this.toast('사물함이 답답하다… 강제로 나왔다!', p); }
      else if (this.isPressed(p, 'act')) this.unhide(p);
      p.moving = false; p.running = false;
      return;
    }

    let mx = 0, my = 0;
    if (this.isDown(p, 'left')) mx -= 1;
    if (this.isDown(p, 'right')) mx += 1;
    if (this.isDown(p, 'up')) my -= 1;
    if (this.isDown(p, 'down')) my += 1;
    // 마우스 클릭 이동: 방향키를 누르면 취소
    if (mx || my) p.moveTarget = null;
    else if (p.moveTarget) {
      const d = this.clickDir(p, dt);
      if (d) { mx = d.x; my = d.y; } else p.moveTarget = null;
    }
    const moving = mx !== 0 || my !== 0;
    p.jumpCd = Math.max(0, p.jumpCd - dt);
    const airborne = p.airT > 0;

    // 앉기(Z 누르는 동안): 느리지만 조용하고 잘 안 보인다
    p.crouching = !airborne && this.isDown(p, 'crouch');

    // 점프(Space): 탁자·침대를 넘을 수 있고 공중에선 잡히지 않는다
    if (!airborne && !p.crouching && p.jumpCd <= 0 && this.isPressed(p, 'jump') && p.stamina >= PLAYER.jumpStamina) {
      p.airT = PLAYER.jumpTime;
      p.jumpCd = PLAYER.jumpCooldown;
      p.stamina -= PLAYER.jumpStamina;
      p.preJump = { x: p.x, y: p.y };
      p.airDir = moving ? { x: mx / Math.hypot(mx, my), y: my / Math.hypot(mx, my) } : { x: 0, y: 0 };
      sfx.tone({ freq: 180, to: 120, dur: 0.12, type: 'triangle', vol: 0.15 });
    }

    if (p.exhausted && p.stamina >= PLAYER.staminaMinToRun) p.exhausted = false;
    const wantRun = this.isDown(p, 'run') && moving && !p.exhausted && !p.crouching;
    p.running = wantRun && p.stamina > 0 && p.airT <= 0;
    if (p.running) {
      p.stamina -= PLAYER.staminaDrain * dt;
      if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; p.running = false; }
    } else if (p.airT <= 0) {
      p.stamina = Math.min(PLAYER.stamina, p.stamina + PLAYER.staminaRegen * dt * (moving ? 0.6 : 1));
    }
    p.moving = moving;

    if (p.airT > 0) {
      // 공중: 점프 방향으로 관성 이동, 낮은 장애물 통과
      const d = moving ? { x: mx / Math.hypot(mx, my), y: my / Math.hypot(mx, my) } : p.airDir;
      const res = this.map.move(p.x, p.y, d.x * PLAYER.jumpSpeed * dt, d.y * PLAYER.jumpSpeed * dt, PLAYER.radius, p.role === 'guard' ? 'guard-air' : 'air');
      p.x = res.x; p.y = res.y;
      if (moving) p.angle = lerpAngle(p.angle, Math.atan2(my, mx), Math.min(1, dt * 14));
      p.airT -= dt;
      if (p.airT <= 0) this.land(p);
    } else if (moving) {
      const len = Math.hypot(mx, my);
      const sp = p.crouching ? PLAYER.crouchSpeed : p.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const res = this.map.move(p.x, p.y, (mx / len) * sp * dt, (my / len) * sp * dt, PLAYER.radius, p.role);
      p.x = res.x; p.y = res.y;
      p.angle = lerpAngle(p.angle, Math.atan2(my, mx), Math.min(1, dt * 14));
    }

    // 달리기 소음
    p.noiseT -= dt;
    if (p.running && p.noiseT <= 0) { p.noiseT = 0.5; this.makeNoise(p.x, p.y, PLAYER.runNoiseRadius, p); }

    if (this.isPressed(p, 'act') && p.airT <= 0) this.action(p);
  }

  /** 착지: 탁자 위에 떨어지면 조금 더 날아가고, 그래도 안 되면 점프 전 자리로 */
  land(p) {
    const r = PLAYER.radius;
    const stuck = () => {
      const m = this.map;
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]])
        if (m.blocked(m.tileOf(p.x + ox), m.tileOf(p.y + oy), p.role)) return true;
      return false;
    };
    if (stuck()) {
      p.airExt = (p.airExt || 0) + 1;
      if (p.airExt <= 4) { p.airT = 0.08; return; }
      p.x = p.preJump.x; p.y = p.preJump.y;
    }
    p.airT = 0;
    p.airExt = 0;
    this.makeNoise(p.x, p.y, PLAYER.landNoiseRadius, p);
    sfx.noise({ dur: 0.15, freq: 250, vol: 0.3 });
  }

  updateRemote(p, dt) {
    const k = 1 - Math.exp(-dt * 14);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
  }

  makeNoise(x, y, r, src) {
    if (this.guardAI && src !== this.guard) this.guardAI.hear(x, y, r);
    if (this.sim) this.sim.noise(x, y, r, PHASES[this.phaseIdx]);
    else this.net.send('noise', { x: Math.round(x), y: Math.round(y), r });
  }

  // ---------------------------------------------------------------- 능력
  nearestLocker(p) {
    let best = null, bd = 46;
    for (const l of this.map.lockers) {
      const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  nearestDoor(p, range = 60) {
    let best = null, bd = range;
    for (const d of this.map.doors) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  action(p) {
    if (p.role === 'prisoner') {
      const l = this.nearestLocker(p);
      if (!l) return;
      if (p.hideCd > 0) { this.toast(`아직 숨을 수 없다 (${Math.ceil(p.hideCd)}초)`, p); return; }
      p.hidden = true; p.hideT = 0; p.lockerId = l.id;
      p.preHide = { x: p.x, y: p.y };
      p.x = l.x; p.y = l.y; // 사물함 안으로
      sfx.door(0.25);
    } else {
      const d = this.nearestDoor(p);
      if (!d) return;
      if (d.broken) { this.toast('부서진 문은 잠글 수 없다', p); return; }
      if (d.locked) {
        d.locked = false;
        sfx.lock();
        this.net.send('door', { id: d.id, locked: false });
        return;
      }
      const lockedCount = this.map.doors.filter((x) => x.locked).length;
      if (lockedCount >= GUARD.maxLocks) { this.toast(`동시에 ${GUARD.maxLocks}개까지만 잠글 수 있다`, p); return; }
      if (p.lockCd > 0) { this.toast(`잠금 장치 재충전 중 (${Math.ceil(p.lockCd)}초)`, p); return; }
      if (this.doorOccupied(d)) { this.toast('문 사이에 무언가 있다', p); return; }
      this.lockDoor(p, d);
    }
  }

  doorOccupied(d) {
    return [this.prisoner, ...this.zombiePositions()].some((e) =>
      d.tiles.some((t) => Math.abs(e.x - (t.tx * TILE + 16)) < 22 && Math.abs(e.y - (t.ty * TILE + 16)) < 22));
  }

  lockDoor(p, d) {
    d.locked = true;
    d.lockedAt = performance.now() / 1000;
    p.lockCd = GUARD.lockCooldown;
    const near = this.me ? Math.hypot(this.me.x - d.x, this.me.y - d.y) : 0;
    sfx.lock(near < 500 ? 1 : 0.3);
    if (p.ai && near < 400) this.toast('🔒 AI 교도관이 문을 잠갔다');
    this.net.send('door', { id: d.id, locked: true });
  }

  unhide(p) {
    p.hidden = false;
    p.hideCd = PRISONER.hideCooldown;
    if (p.preHide) { p.x = p.preHide.x; p.y = p.preHide.y; }
    p.lockerId = -1;
    sfx.door(0.25);
  }

  onDoorBroken(door) {
    if (!door) return;
    door.broken = true;
    door.locked = false;
    sfx.slam();
    this.cameras.main.shake(300, 0.006);
    this.toast('💥 강한 좀비가 잠긴 문을 부쉈다!');
  }

  /** 교도관에게 잡힌 죄수(죄수 클라이언트에서 실행) */
  onArrested() {
    const p = this.prisoner;
    if (!p.local || p.hidden || this.over) return;
    const now = performance.now() / 1000;
    if (now < p.immuneUntil) return;
    p.immuneUntil = now + PRISONER.arrestImmunity;
    let dropped = false;
    if (p.keys > 0) {
      const k = this.keys.find((k) => k.taken);
      if (k) {
        // 바닥 타일 중앙에 떨어뜨림
        const tx = this.map.tileOf(p.x), ty = this.map.tileOf(p.y);
        const c = this.map.center(tx, ty);
        k.taken = false; k.x = c.x; k.y = c.y;
        p.keys -= 1;
        dropped = true;
      }
    }
    p.x = this.map.prisonerSpawn.x; p.y = this.map.prisonerSpawn.y;
    p.tx = p.x; p.ty = p.y;
    sfx.arrest();
    this.cameras.main.flash(400, 120, 140, 255);
    if (this.guardAI) { this.guardAI.mode = 'patrol'; this.guardAI.target = null; }
    this.toast(`🚨 체포됐다! 감방으로 이송${dropped ? ' · 열쇠 조각 1개를 떨어뜨렸다' : ''}`);
    this.applyKeys(this.keysState());
    this.net.send('keys', this.keysState());
    this.net.send('arrested', { dropped });
  }

  keysState() { return this.keys.map((k) => [k.id, Math.round(k.x), Math.round(k.y), k.taken ? 1 : 0]); }

  applyKeys(list) {
    for (const [id, x, y, taken] of list) {
      const k = this.keys[id];
      if (!k) continue;
      k.x = x; k.y = y; k.taken = !!taken;
      k.sprite.setPosition(x, y).setVisible(!k.taken);
      k.glow.setPosition(x, y).setVisible(!k.taken);
    }
  }

  checkInteractions() {
    const pr = this.prisoner, gd = this.guard;

    // 열쇠 줍기 / 탈출 (죄수 측 권한)
    if (pr.local && !pr.hidden) {
      for (const k of this.keys) {
        if (!k.taken && Math.hypot(k.x - pr.x, k.y - pr.y) < 26) {
          k.taken = true; pr.keys += 1;
          sfx.pickup();
          this.toast(`🔑 열쇠 조각 ${pr.keys}/${PRISONER.keysNeeded}`, pr);
          this.applyKeys(this.keysState());
          this.net.send('keys', this.keysState());
          if (pr.keys >= PRISONER.keysNeeded) this.toast('열쇠 완성! 운동장 동쪽 정문으로!', pr);
        }
      }
      const gd2 = Math.hypot(this.map.gateCenter.x - pr.x, this.map.gateCenter.y - pr.y);
      if (gd2 < 56 && pr.keys >= PRISONER.keysNeeded) { sfx.gate(); this.finish('escape', pr.userId); return; }
    }

    // 체포 (교도관 측 권한)
    if ((gd.local || gd.ai) && gd.arrestCd <= 0 && !pr.hidden && pr.airT <= 0) {
      const d = Math.hypot(pr.x - gd.x, pr.y - gd.y);
      if (d < GUARD.arrestRange) {
        gd.arrestCd = PRISONER.arrestImmunity + 0.5;
        if (this.net.mode !== 'online') this.onArrested();
        else { this.net.send('arrest', {}); sfx.arrest(); this.toast('🚨 체포 성공! 죄수를 감방으로 돌려보냈다', gd); }
      }
    }

    // 좀비에게 잡힘 (각자 자기 캐릭터만 판정)
    for (const p of this.players) {
      if (!(p.local || p.ai) || p.hidden || p.dead || p.airT > 0) continue; // 공중에선 잡히지 않는다
      for (const z of this.zombiePositions()) {
        if (z.state === 0) continue;
        const r = z.type ? ZOMBIE.bruteCatchDist : ZOMBIE.catchDist;
        if (Math.hypot(z.x - p.x, z.y - p.y) < r) {
          p.dead = true;
          p.img.setTint(0xff4040);
          sfx.caught();
          document.getElementById('fx-red').classList.add('hit');
          this.cameras.main.shake(500, 0.012);
          this.finish('zombie', p.userId);
          return;
        }
      }
    }
  }

  zombiePositions() {
    if (this.sim) return this.sim.list;
    return [...this.zombieViews.values()];
  }

  // ---------------------------------------------------------------- 문
  updateDoors(dt) {
    const ents = [...this.players.filter((p) => !p.hidden).map((p) => ({ x: p.x, y: p.y, kind: p.role, local: p.local || p.ai, crouching: p.crouching, ref: p })),
      ...this.zombiePositions().map((z) => ({ x: z.x, y: z.y, kind: z.type ? 'brute' : 'zombie' }))];
    const lockAuthority = this.guard.local || this.guard.ai;
    const now = performance.now() / 1000;
    for (const d of this.map.doors) {
      // 잠금 자동 해제(교도관 측 권한)
      if (lockAuthority && d.locked && !d.broken && d.lockedAt && now - d.lockedAt > GUARD.lockDuration) {
        d.locked = false;
        this.net.send('door', { id: d.id, locked: false });
      }
      let want = false, localOpener = null;
      if (d.broken) want = true;
      else {
        for (const e of ents) {
          if (Math.hypot(e.x - d.x, e.y - d.y) < 46 && (!d.locked || e.kind === 'guard')) {
            want = true;
            if (e.local && !e.crouching) localOpener = e.ref; // 앉아서 지나가면 조용하다
          }
        }
      }
      if (want && !d.isOpen) {
        d.isOpen = true;
        if (localOpener) { this.makeNoise(d.x, d.y, PLAYER.doorNoiseRadius, localOpener); if (localOpener.local) sfx.door(0.35); }
      } else if (!want && d.isOpen) {
        d.isOpen = false;
      }
      d.open += ((d.isOpen ? 1 : 0) - d.open) * Math.min(1, dt * 10);
    }
  }

  drawDoors() {
    const g = this.doorGfx;
    g.clear();
    for (const d of this.map.doors) {
      const xs = d.tiles.map((t) => t.tx), ys = d.tiles.map((t) => t.ty);
      const x0 = Math.min(...xs) * TILE, y0 = Math.min(...ys) * TILE;
      const w = (Math.max(...xs) - Math.min(...xs) + 1) * TILE, h = (Math.max(...ys) - Math.min(...ys) + 1) * TILE;
      if (d.broken) {
        g.fillStyle(0x3a3a3a, 1);
        if (d.horizontal) { g.fillRect(x0 - 4, y0 + 2, 10, 6); g.fillRect(x0 + w - 10, y0 + h - 10, 12, 7); }
        else { g.fillRect(x0 + 2, y0 - 4, 7, 12); g.fillRect(x0 + w - 9, y0 + h - 8, 7, 12); }
        g.fillStyle(0x6b1010, 0.6); g.fillCircle(d.x, d.y, 6);
        continue;
      }
      const o = d.open;
      // 문틀
      g.fillStyle(0x15171a, 1);
      if (d.horizontal) g.fillRect(x0, y0 + 11, w, 10); else g.fillRect(x0 + 11, y0, 10, h);
      // 미닫이 두 짝
      const color = d.locked ? 0x5a2320 : 0x50585e;
      g.fillStyle(color, 1);
      if (d.horizontal) {
        const half = (w / 2) * (1 - o);
        g.fillRect(x0, y0 + 12, half, 8);
        g.fillRect(x0 + w - half, y0 + 12, half, 8);
        g.fillStyle(0xffffff, 0.12); g.fillRect(x0, y0 + 12, half, 2); g.fillRect(x0 + w - half, y0 + 12, half, 2);
      } else {
        const half = (h / 2) * (1 - o);
        g.fillRect(x0 + 12, y0, 8, half);
        g.fillRect(x0 + 12, y0 + h - half, 8, half);
        g.fillStyle(0xffffff, 0.12); g.fillRect(x0 + 12, y0, 2, half); g.fillRect(x0 + 12, y0 + h - half, 2, half);
      }
      // 상태등
      const lamp = d.locked ? 0xff2a1a : 0x4cd04c;
      g.fillStyle(lamp, d.locked ? 0.9 : 0.5);
      if (d.horizontal) { g.fillCircle(x0 - 3, y0 + 16, 3); g.fillCircle(x0 + w + 3, y0 + 16, 3); }
      else { g.fillCircle(x0 + 16, y0 - 3, 3); g.fillCircle(x0 + 16, y0 + h + 3, 3); }
    }
  }

  // ---------------------------------------------------------------- 좀비 표시
  applyZombies(arr) {
    const seen = new Set();
    for (let i = 0; i < arr.length; i += 6) {
      const id = arr[i];
      seen.add(id);
      let v = this.zombieViews.get(id);
      if (!v) {
        v = { id, x: arr[i + 1], y: arr[i + 2], angle: arr[i + 3] / 100, type: arr[i + 4], state: arr[i + 5] };
        this.zombieViews.set(id, v);
      }
      v.tx = arr[i + 1]; v.ty = arr[i + 2]; v.ta = arr[i + 3] / 100; v.type = arr[i + 4]; v.state = arr[i + 5];
    }
    for (const [id, v] of this.zombieViews) {
      if (!seen.has(id)) { this.destroyZView(v); this.zombieViews.delete(id); }
    }
  }

  destroyZView(v) { v.img?.destroy(); v.shadow?.destroy(); }

  updateZombieViews(dt) {
    // 방장: sim 목록 → 표시 객체
    const list = this.sim ? this.sim.list : [...this.zombieViews.values()];
    const k = 1 - Math.exp(-dt * 10);
    for (const z of list) {
      if (!this.sim && z.tx !== undefined) {
        z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k;
        z.angle = lerpAngle(z.angle, z.ta, k);
      }
      if (!z.img) {
        const { img, shadow } = this.makeCharacter(z.type ? 'brute' : 'zombie', z.type ? SPRITE_H.brute : SPRITE_H.zombie);
        z.img = img; z.shadow = shadow;
        img.setTint(0xb8c0b0);
        z.bob = Math.random() * 10;
      }
      z.bob += dt * (z.state === 2 ? 9 : 4);
      const spawning = z.state === 0;
      const sc = z.img.baseScale * (spawning ? 0.6 : 1) * (1 + Math.sin(z.bob) * 0.025);
      z.img.setPosition(z.x, z.y).setRotation(z.angle - Math.PI / 2).setScale(sc).setAlpha(spawning ? 0.6 : 1);
      z.shadow.setPosition(z.x + 4, z.y + 6);
    }
  }

  // ---------------------------------------------------------------- 캐릭터 표시 / 시야
  canSee(viewer, target) {
    if (target.hidden) return false;
    const dx = target.x - viewer.x, dy = target.y - viewer.y;
    const d = Math.hypot(dx, dy) / (target.crouching ? PLAYER.crouchVisibleMul : 1);
    let inLight = false;
    if (viewer.role === 'prisoner') inLight = d < (viewer.hidden ? 60 : PLAYER.prisonerLight);
    else {
      if (d < PLAYER.guardAmbientLight) inLight = true;
      else if (d < PLAYER.guardFlashlight) {
        let da = Math.atan2(dy, dx) - viewer.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        inLight = Math.abs(da) < (PLAYER.guardFlashlightAngle * Math.PI) / 360;
      }
    }
    // 교도관 손전등은 멀리서도 보인다
    if (!inLight && target.role === 'guard' && d < 600) inLight = true;
    return inLight && this.map.los(viewer.x, viewer.y, target.x, target.y);
  }

  updateCharacters(dt) {
    for (const p of this.players) {
      p.bob += dt * (p.moving ? (p.running ? 14 : 9) : 2);
      // 점프: 커졌다 작아지고 그림자가 멀어진다 / 앉기: 작고 어둡게
      const air = p.airT > 0 ? Math.sin(Math.PI * Math.min(1, 1 - p.airT / PLAYER.jumpTime)) : 0;
      const sc = p.img.baseScale * (1 + (p.moving ? Math.sin(p.bob) * 0.035 : 0) + air * 0.28) * (p.crouching ? 0.82 : 1);
      p.img.setPosition(p.x, p.y - air * 10).setRotation(p.angle - Math.PI / 2).setScale(sc);
      p.img.setTint(p.dead ? 0xff4040 : p.crouching ? 0x9a9a9a : 0xffffff);
      p.shadow.setPosition(p.x + 4 + air * 10, p.y + 6 + air * 14).setScale(p.shadow.scaleX0 * (1 - air * 0.35), p.shadow.scaleY0 * (1 - air * 0.35));
      let alpha = 1;
      if (p.hidden) alpha = p.local ? 0.35 : 0;
      else if (this.me && !p.local) alpha = this.canSee(this.me, p) ? 1 : 0;
      const immune = p.role === 'prisoner' && p.local && performance.now() / 1000 < p.immuneUntil;
      if (immune) alpha *= 0.5 + Math.sin(performance.now() / 60) * 0.3;
      p.img.alpha += (alpha - p.img.alpha) * Math.min(1, dt * 12);
      p.shadow.alpha = p.img.alpha * 0.8;
    }
    // 숨은 사물함 흔들림
    this.lockerSprites.forEach((s, i) => {
      const occ = this.prisoner.hidden && this.prisoner.lockerId === i && this.prisoner.local;
      s.x = this.map.lockers[i].x + (occ ? Math.sin(performance.now() / 40) * 0.8 : 0);
    });
  }

  rays(x, y, radius, center, spread, n) {
    const pts = [];
    const start = center - spread / 2;
    for (let i = 0; i <= n; i++) {
      const a = start + (spread * i) / n;
      pts.push([a, Math.min(radius, this.map.castRay(x, y, a, radius) + 10)]);
    }
    return pts;
  }

  fillLight(x, y, pts, scale, alpha, cone) {
    const g = this.lightG;
    g.fillStyle(0xffffff, alpha);
    g.beginPath();
    if (cone) g.moveTo(x, y);
    pts.forEach(([a, d], i) => {
      const r = d * scale;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0 && !cone) g.moveTo(px, py); else g.lineTo(px, py);
    });
    g.closePath();
    g.fillPath();
  }

  /** 여러 겹으로 겹쳐 부드러운 감쇠를 흉내 낸다 */
  softLight(x, y, pts, strength, cone) {
    const layers = 7;
    for (let i = 0; i < layers; i++) {
      const scale = 1 - (i / layers) * 0.75;
      this.fillLight(x, y, pts, scale, 0.22 * strength, cone);
    }
  }

  drawLights(time) {
    const g = this.lightG;
    g.clear();
    const add = (p, strength = 1) => {
      if (p.role === 'prisoner') {
        if (!p.local) return;
        const r = p.hidden ? 60 : PLAYER.prisonerLight;
        const pts = this.rays(p.x, p.y, r, 0, Math.PI * 2, 72);
        this.softLight(p.x, p.y, pts, strength, false);
      } else {
        const flick = 0.92 + Math.random() * 0.08;
        if (p.local) {
          const amb = this.rays(p.x, p.y, PLAYER.guardAmbientLight, 0, Math.PI * 2, 48);
          this.softLight(p.x, p.y, amb, 0.9, false);
        }
        const spread = (PLAYER.guardFlashlightAngle * Math.PI) / 180;
        const cone = this.rays(p.x, p.y, PLAYER.guardFlashlight, p.angle, spread, 44);
        const narrow = this.rays(p.x, p.y, PLAYER.guardFlashlight * 0.85, p.angle, spread * 0.55, 30);
        this.softLight(p.x, p.y, cone, strength * flick * 0.85, true);
        this.softLight(p.x, p.y, narrow, strength * flick * 0.6, true);
      }
    };
    for (const p of this.players) {
      if (p.local) add(p);
      else if (p.role === 'guard' && !this.over) add(p, 0.35); // 멀리서 보이는 상대 손전등
    }
    // 비상등
    const high = this.phaseIdx >= 2;
    for (const l of this.lamps) {
      l.flick = Math.random() < 0.04 ? 0.2 : l.flick + (1 - l.flick) * 0.1;
      const pulse = (Math.sin(time / (high ? 220 : 600) + l.phase) * 0.5 + 0.5) * l.flick;
      g.fillStyle(0xffffff, 0.12 + pulse * (high ? 0.3 : 0.15));
      g.fillCircle(l.x, l.y, 70);
      l.g.setAlpha((high ? 0.35 : 0.18) + pulse * (high ? 0.4 : 0.2));
    }
    // 열쇠 미세광(죄수만)
    if (this.prisoner.local) {
      for (const k of this.keys) if (!k.taken) { g.fillStyle(0xffffff, 0.25); g.fillCircle(k.x, k.y, 18); }
    }

    this.dark.clear();
    if (NO_FOG) return;
    this.dark.fill(0x020305, this.net.mode === 'local' ? 0.88 : 0.95);
    this.dark.erase(g);
  }

  // ---------------------------------------------------------------- 사운드/분위기
  ambientSounds(dt) {
    const viewers = this.players.filter((p) => p.local);
    if (!viewers.length) return;
    let nearest = Infinity, nz = null, nv = viewers[0];
    for (const z of this.zombiePositions()) {
      for (const v of viewers) {
        const d = Math.hypot(z.x - v.x, z.y - v.y);
        if (d < nearest) { nearest = d; nz = z; nv = v; }
      }
    }
    this.groanT -= dt;
    if (nz && this.groanT <= 0 && nearest < 420) {
      this.groanT = 1.5 + Math.random() * 3;
      const vol = Math.max(0.05, 0.4 * (1 - nearest / 420));
      sfx.groan(vol, Phaser.Math.Clamp((nz.x - nv.x) / 300, -1, 1));
    }
    this.beatT -= dt;
    if (nearest < 200 && this.beatT <= 0) {
      this.beatT = nearest < 110 ? 0.55 : 0.9;
      sfx.heartbeat(0.35 + (1 - nearest / 200) * 0.4);
    }
  }

  onPhaseChange(i) {
    const p = PHASES[i];
    const desc = i === 1 ? '좀비가 늘어나고 소리에 민감해졌다. 무리 지어 다닌다.' : '문을 부수는 강한 좀비가 나타났다!';
    hud.banner(`⚠ 감염 단계 상승 — ${p.name}`, desc);
    sfx.siren(3.5);
    const red = document.getElementById('fx-red');
    red.classList.add('alarm');
    setTimeout(() => { if (i < 2) red.classList.remove('alarm'); }, 4500);
    this.cameras.main.shake(400, 0.004);
  }

  toast(text, p) {
    const prefix = this.net.mode === 'local' && p ? `[${ROLE_KO[p.role]}] ` : '';
    hud.message(prefix + text);
  }

  // ---------------------------------------------------------------- 네트워크
  sendNet(dt) {
    if (this.net.mode !== 'online' || this.over) return;
    this.netT -= dt;
    if (this.netT <= 0 && this.me) {
      this.netT = 1 / GAME.NET_RATE;
      const p = this.me;
      this.net.send('p', {
        x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.angle * 100),
        r: p.running ? 1 : 0, h: p.hidden ? 1 : 0, m: p.moving ? 1 : 0, k: p.keys,
        c: p.crouching ? 1 : 0, j: p.airT > 0 ? 1 : 0,
      });
    }
    if (this.sim) {
      this.zNetT -= dt;
      if (this.zNetT <= 0) { this.zNetT = 1 / GAME.ZOMBIE_NET_RATE; this.net.send('z', this.sim.serialize()); }
    }
  }

  async finish(reason, actorId) {
    if (this.over) return;
    this.over = true;
    const big = { escape: '탈출!', time: '06:00 — 시간 종료', zombie: '물렸다…', disconnect: '상대가 떠났다' }[reason];
    hud.banner(big, '');
    try {
      let state = await this.net.endGame(reason, actorId);
      if (state.room.status !== 'finished') state = await this.retryEnd(reason, actorId);
      this.net.send('over', {});
      this.done(state);
    } catch (e) {
      console.error(e);
      // 시간 종료가 서버 시계보다 살짝 빠른 경우 등 → 재시도
      setTimeout(async () => {
        try {
          const state = await this.net.endGame(reason, actorId);
          this.net.send('over', {});
          this.done(state);
        } catch (e2) {
          hud.message('결과 기록 실패: ' + e2.message);
          this.fetchOver();
        }
      }, 2000);
    }
  }

  async retryEnd(reason, actorId) {
    await new Promise((r) => setTimeout(r, 1500));
    return this.net.endGame(reason, actorId);
  }

  async fetchOver() {
    this.over = true;
    for (let i = 0; i < 5; i++) {
      try {
        const state = await this.net.refresh();
        if (state.room.status === 'finished') { this.done(state); return; }
      } catch (e) { console.warn(e); }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  done(state) {
    if (this.finished) return;
    this.finished = true;
    this.time.delayedCall(1600, () => {
      document.getElementById('fx-red').classList.remove('hit', 'alarm');
      this.cameras.main.fadeOut(700, 0, 0, 0);
      // 씬 업데이트 도중에 씬을 멈추지 않도록 다음 틱으로 미룬다
      this.cameras.main.once('camerafadeoutcomplete', () => setTimeout(() => this.onGameOver(state), 0));
    });
  }
}
