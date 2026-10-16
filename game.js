"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startScreen = document.getElementById("start-screen");
const resultScreen = document.getElementById("result-screen");
const gameHud = document.getElementById("game-hud");
const toast = document.getElementById("toast");
const W = canvas.width;
const H = canvas.height;
const keysDown = new Set();
const ROLE = { PRISONER: "prisoner", GUARD: "guard" };

const rooms = [
  { x: 34, y: 42, w: 300, h: 195, name: "운동장", fill: "#27352a" },
  { x: 344, y: 42, w: 272, h: 195, name: "감방 구역", fill: "#343831" },
  { x: 626, y: 42, w: 300, h: 195, name: "식당", fill: "#35352d" },
  { x: 34, y: 251, w: 300, h: 187, name: "세탁실", fill: "#2c342e" },
  { x: 344, y: 251, w: 272, h: 187, name: "중앙 복도", fill: "#39392f" },
  { x: 626, y: 251, w: 300, h: 187, name: "경비실", fill: "#2e3934" },
  { x: 34, y: 452, w: 892, h: 108, name: "정문 진입로", fill: "#292d27" },
];

const walls = [
  { x: 332, y: 42, w: 12, h: 74 },
  { x: 332, y: 169, w: 12, h: 38 },
  { x: 616, y: 42, w: 10, h: 62 },
  { x: 616, y: 130, w: 10, h: 92 },
  { x: 34, y: 241, w: 380, h: 10 },
  { x: 536, y: 241, w: 390, h: 10 },
  { x: 332, y: 251, w: 12, h: 60 },
  { x: 332, y: 371, w: 12, h: 67 },
  { x: 616, y: 251, w: 10, h: 47 },
  { x: 616, y: 333, w: 10, h: 105 },
  { x: 34, y: 442, w: 392, h: 10 },
  { x: 536, y: 442, w: 390, h: 10 },
  { x: 147, y: 80, w: 12, h: 97 },
  { x: 450, y: 75, w: 8, h: 68 },
  { x: 504, y: 75, w: 8, h: 68 },
  { x: 751, y: 79, w: 71, h: 8 },
  { x: 727, y: 321, w: 12, h: 68 },
  { x: 822, y: 321, w: 12, h: 68 },
  { x: 409, y: 305, w: 82, h: 10 },
];

const lockers = [
  { x: 75, y: 296, w: 54, h: 28 },
  { x: 164, y: 367, w: 54, h: 28 },
  { x: 681, y: 278, w: 40, h: 25 },
];

let selectedRole = ROLE.PRISONER;
let state = null;
let previousTime = 0;
let toastTimeout = 0;
let audioContext = null;
let soundEnabled = false;

function makeActor(x, y, role, isPlayer) {
  return {
    x, y, role, isPlayer, angle: 0, stamina: 100, hidden: false,
    hideTimer: 0, arrestCooldown: 0, keys: 0, step: 0, caught: false,
  };
}

function startGame() {
  const prisonerStart = selectedRole === ROLE.PRISONER;
  state = {
    active: true,
    paused: false,
    elapsed: 0,
    duration: 180,
    role: selectedRole,
    player: makeActor(prisonerStart ? 92 : 781, prisonerStart ? 331 : 355, selectedRole, true),
    opponent: makeActor(prisonerStart ? 777 : 87, prisonerStart ? 372 : 335, prisonerStart ? ROLE.GUARD : ROLE.PRISONER, false),
    zombies: [
      { x: 516, y: 184, angle: 0.5, wander: 0, speed: 43 },
      { x: 213, y: 493, angle: -0.8, wander: 0, speed: 46 },
      { x: 846, y: 179, angle: 2.5, wander: 0, speed: 50 },
    ],
    fragments: [{ x: 279, y: 113 }, { x: 568, y: 350 }, { x: 686, y: 496 }],
    doorOpen: false,
    message: "",
    messageTimer: 0,
    lastSpawn: 0,
    alarmLevel: 0,
  };
  startScreen.hidden = true;
  resultScreen.hidden = true;
  gameHud.hidden = false;
  document.getElementById("role-label").textContent = prisonerStart ? "탈출 목표" : "방어 목표";
  document.getElementById("objective").innerHTML = prisonerStart
    ? '열쇠 조각 <span id="key-count">0</span> / 3'
    : "남은 시간 생존";
  document.getElementById("key-count").textContent = "0";
  updateHUD();
  keysDown.clear();
}

function finishGame(winner, reason) {
  if (!state || !state.active) return;
  state.active = false;
  gameHud.hidden = true;
  resultScreen.hidden = false;
  const playerWon = winner === state.role;
  const title = document.getElementById("result-title");
  const copy = document.getElementById("result-copy");
  const eyebrow = document.getElementById("result-eyebrow");
  eyebrow.textContent = playerWon ? "INCIDENT REPORT · SURVIVOR" : "INCIDENT REPORT · LOST";
  if (reason === "escape") {
    title.textContent = playerWon ? "탈출 성공" : "죄수가 탈출했다";
    copy.textContent = playerWon ? "드디어… 밖이다. 그러나 도시는 너무 조용하다." : "정문이 열렸다. 이번 교대는 실패했다.";
  } else if (reason === "timeout") {
    title.textContent = playerWon ? "마지막 근무 완료" : "교대 시간 종료";
    copy.textContent = playerWon ? "06:00. 교대 시간이다. 헬기 불빛이 운동장을 비춘다." : "죄수가 감옥에 남았다. 하지만 여기는 더는 안전하지 않다.";
  } else if (reason === "arrest") {
    title.textContent = playerWon ? "죄수 체포" : "체포당했다";
    copy.textContent = playerWon ? "열쇠를 되찾았다. 남은 시간을 버텨라." : "손목에 수갑이 채워졌다. 탈출은 다음 기회에.";
  } else {
    title.textContent = playerWon ? "상대 생존 실패" : "감염됨";
    copy.textContent = playerWon ? "좀비가 상대를 덮쳤다. 당신은 살아남았다." : "감염자가 어둠 속에서 달려들었다.";
  }
  playTone(playerWon ? 660 : 180, .16);
}

function updateHUD() {
  if (!state) return;
  const left = Math.max(0, Math.ceil(state.duration - state.elapsed));
  const mins = Math.floor(left / 60).toString().padStart(2, "0");
  const secs = (left % 60).toString().padStart(2, "0");
  document.getElementById("timer").textContent = `${mins}:${secs}`;
  const keyCount = state.role === ROLE.PRISONER ? state.player.keys : state.opponent.keys;
  const count = document.getElementById("key-count");
  if (count) count.textContent = String(keyCount);
  const phase = state.elapsed < 55 ? 1 : state.elapsed < 115 ? 2 : 3;
  document.getElementById("threat-label").textContent = ["초기 단계", "감염 확산", "봉쇄 붕괴"][phase - 1];
  document.getElementById("threat-progress").style.width = `${18 + phase * 25}%`;
  document.getElementById("alert-label").textContent = phase === 3 ? "위험 임박" : phase === 2 ? "위협 접근" : "위험 감지";
}

function moveActor(actor, dx, dy, dt) {
  const speed = actor.isPlayer ? 128 : actor.role === ROLE.GUARD ? 67 : 74;
  const moving = Math.hypot(dx, dy) > 0;
  if (moving) {
    const magnitude = Math.hypot(dx, dy) || 1;
    dx /= magnitude;
    dy /= magnitude;
    actor.angle = Math.atan2(dy, dx);
  }
  const sprinting = actor.isPlayer && keysDown.has("shift") && actor.stamina > 1 && !actor.hidden;
  const actualSpeed = speed * (sprinting ? 1.55 : 1) * (actor.hidden ? .25 : 1);
  if (actor.isPlayer) {
    actor.stamina = Math.max(0, Math.min(100, actor.stamina + (sprinting ? -34 : 22) * dt));
    if (sprinting && moving) state.alarmLevel = Math.min(1, state.alarmLevel + dt * .16);
  }
  const nextX = actor.x + dx * actualSpeed * dt;
  if (!collides(nextX, actor.y, 12)) actor.x = nextX;
  const nextY = actor.y + dy * actualSpeed * dt;
  if (!collides(actor.x, nextY, 12)) actor.y = nextY;
  if (moving) actor.step += dt * (sprinting ? 14 : 8);
}

function collides(x, y, radius) {
  if (x < 25 + radius || x > W - 25 - radius || y < 32 + radius || y > H - 32 - radius) return true;
  return walls.some((wall) => x + radius > wall.x && x - radius < wall.x + wall.w && y + radius > wall.y && y - radius < wall.y + wall.h);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateBot(actor, target, dt) {
  if (!actor || actor.caught) return;
  actor.arrestCooldown = Math.max(0, actor.arrestCooldown - dt);
  let dx = target.x - actor.x;
  let dy = target.y - actor.y;
  if (actor.role === ROLE.PRISONER) {
    const nearest = state.fragments.filter((item) => !item.taken).sort((a, b) => distance(actor, a) - distance(actor, b))[0];
    if (nearest && actor.keys < 3) {
      dx = nearest.x - actor.x;
      dy = nearest.y - actor.y;
    } else if (actor.keys >= 3) {
      dx = 882 - actor.x;
      dy = 503 - actor.y;
    } else {
      dx = 483 - actor.x;
      dy = 342 - actor.y;
    }
  } else if (distance(actor, target) > 125) {
    const patrol = (state.elapsed * .3) % (Math.PI * 2);
    dx = Math.cos(patrol) * 35;
    dy = Math.sin(patrol) * 35;
  }
  moveActor(actor, Math.sign(dx), Math.sign(dy), dt);
}

function updateZombies(dt) {
  const targets = [state.player, state.opponent].filter((actor) => !actor.hidden && !actor.caught);
  state.zombies.forEach((zombie, index) => {
    const target = targets.sort((a, b) => distance(zombie, a) - distance(zombie, b))[0];
    const detection = (state.elapsed > 115 ? 300 : state.elapsed > 55 ? 235 : 170) + state.alarmLevel * 170;
    if (target && distance(zombie, target) < detection) {
      const angle = Math.atan2(target.y - zombie.y, target.x - zombie.x);
      zombie.angle = angle;
      const phaseSpeed = state.elapsed > 115 ? 78 : state.elapsed > 55 ? 62 : zombie.speed;
      const nx = zombie.x + Math.cos(angle) * phaseSpeed * dt;
      const ny = zombie.y + Math.sin(angle) * phaseSpeed * dt;
      if (!collides(nx, zombie.y, 10)) zombie.x = nx;
      else zombie.angle += Math.PI * .65;
      if (!collides(zombie.x, ny, 10)) zombie.y = ny;
      if (distance(zombie, target) < 19) {
        if (target === state.player) finishGame(state.opponent.role, "zombie");
        else if (target === state.opponent) finishGame(state.player.role, "zombie");
      }
    } else {
      zombie.wander -= dt;
      if (zombie.wander <= 0) {
        zombie.angle += (Math.random() - .5) * 2.6;
        zombie.wander = 1.1 + Math.random() * 2.1;
      }
      const nx = zombie.x + Math.cos(zombie.angle) * 28 * dt;
      const ny = zombie.y + Math.sin(zombie.angle) * 28 * dt;
      if (!collides(nx, zombie.y, 10)) zombie.x = nx;
      else zombie.angle = Math.PI - zombie.angle + index * .7;
      if (!collides(zombie.x, ny, 10)) zombie.y = ny;
      else zombie.angle = -zombie.angle + .8;
    }
  });
}

function update(dt) {
  if (!state || !state.active || state.paused) return;
  state.elapsed += dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  state.alarmLevel = Math.max(0, state.alarmLevel - dt * .07);
  const player = state.player;
  player.arrestCooldown = Math.max(0, player.arrestCooldown - dt);
  if (player.hideTimer > 0) {
    player.hideTimer -= dt;
    if (player.hideTimer <= 0) {
      player.hidden = false;
      showToast("숨을 곳에서 나왔습니다.");
    }
  }

  let dx = (keysDown.has("d") || keysDown.has("arrowright") ? 1 : 0) - (keysDown.has("a") || keysDown.has("arrowleft") ? 1 : 0);
  let dy = (keysDown.has("s") || keysDown.has("arrowdown") ? 1 : 0) - (keysDown.has("w") || keysDown.has("arrowup") ? 1 : 0);
  if (player.hidden) dx = dy = 0;
  moveActor(player, dx, dy, dt);
  updateBot(state.opponent, player, dt);

  for (const actor of [player, state.opponent]) {
    for (const fragment of state.fragments) {
      if (!fragment.taken && actor.role === ROLE.PRISONER && distance(actor, fragment) < 21) {
        fragment.taken = true;
        actor.keys += 1;
        showToast(actor.isPlayer ? `열쇠 조각 획득 (${actor.keys}/3)` : "죄수가 열쇠 조각을 찾았습니다.");
        playTone(530 + actor.keys * 100, .08);
      }
    }
  }

  if (state.role === ROLE.PRISONER && player.keys === 3 && player.x > 850 && player.y > 469) finishGame(ROLE.PRISONER, "escape");
  if (state.opponent.role === ROLE.PRISONER && state.opponent.keys === 3 && state.opponent.x > 850 && state.opponent.y > 469) finishGame(ROLE.PRISONER, "escape");

  if (state.role === ROLE.GUARD && distance(player, state.opponent) < 24 && player.arrestCooldown === 0) {
    state.opponent.x = 72;
    state.opponent.y = 362;
    state.opponent.keys = Math.max(0, state.opponent.keys - 1);
    if (state.opponent.keys > 0) state.fragments.push({ x: 478, y: 332, taken: false });
    player.arrestCooldown = 2.5;
    showToast("죄수를 체포해 감방으로 돌려보냈습니다.");
  }
  if (state.role === ROLE.PRISONER && distance(player, state.opponent) < 20 && state.opponent.arrestCooldown === 0) {
    player.x = 76;
    player.y = 352;
    player.keys = Math.max(0, player.keys - 1);
    if (player.keys < 3 && player.keys >= 0) state.fragments.push({ x: 480, y: 341, taken: false });
    player.arrestCooldown = 3;
    showToast("교도관에게 체포됐습니다. 열쇠 조각을 잃었습니다.");
  }

  updateZombies(dt);
  if (state.elapsed >= state.duration) finishGame(ROLE.GUARD, "timeout");
  if (Math.floor(state.elapsed) % 2 === 0) updateHUD();
}

function drawFloor() {
  ctx.fillStyle = "#111713";
  ctx.fillRect(0, 0, W, H);
  rooms.forEach((room, index) => {
    ctx.fillStyle = room.fill;
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.fillStyle = "rgba(218, 216, 186, .035)";
    for (let x = room.x + 8; x < room.x + room.w; x += 24) {
      for (let y = room.y + 8; y < room.y + room.h; y += 24) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.strokeStyle = "rgba(5, 9, 7, .22)";
    ctx.lineWidth = 1;
    for (let x = room.x + 12; x < room.x + room.w; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, room.y); ctx.lineTo(x, room.y + room.h); ctx.stroke();
    }
    ctx.fillStyle = "rgba(220, 225, 205, .42)";
    ctx.font = "9px 'DM Mono', monospace";
    ctx.fillText(room.name.toUpperCase(), room.x + 10, room.y + 15);
    if (index === 0) drawYard(room);
    if (index === 1) drawCells(room);
    if (index === 2) drawTables(room);
  });

  walls.forEach((wall) => {
    const gradient = ctx.createLinearGradient(wall.x, wall.y, wall.x + wall.w, wall.y + wall.h);
    gradient.addColorStop(0, "#73756a");
    gradient.addColorStop(.28, "#484e45");
    gradient.addColorStop(1, "#252c27");
    ctx.fillStyle = gradient;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = "rgba(224, 222, 194, .14)";
    ctx.strokeRect(wall.x + .5, wall.y + .5, wall.w - 1, wall.h - 1);
  });

  lockers.forEach((locker) => {
    ctx.fillStyle = "#525951";
    ctx.fillRect(locker.x, locker.y, locker.w, locker.h);
    ctx.fillStyle = "#303832";
    ctx.fillRect(locker.x + 3, locker.y + 3, locker.w / 2 - 5, locker.h - 6);
    ctx.fillRect(locker.x + locker.w / 2 + 2, locker.y + 3, locker.w / 2 - 5, locker.h - 6);
    ctx.fillStyle = "#b0aa82";
    ctx.fillRect(locker.x + locker.w / 2 - 1, locker.y + locker.h / 2, 2, 2);
  });
  drawExit();
}

function drawYard(room) {
  ctx.strokeStyle = "rgba(169, 177, 137, .12)";
  ctx.lineWidth = 1;
  for (let x = room.x + 24; x < room.x + room.w; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, room.y + 27); ctx.lineTo(x, room.y + room.h - 8); ctx.stroke();
  }
  ctx.fillStyle = "#3e4538";
  ctx.fillRect(room.x + 26, room.y + 58, 45, 17);
  ctx.fillRect(room.x + 201, room.y + 123, 55, 18);
  ctx.fillStyle = "#69715b";
  ctx.fillRect(room.x + 26, room.y + 55, 45, 3);
  ctx.fillRect(room.x + 201, room.y + 120, 55, 3);
}

function drawCells(room) {
  for (let i = 0; i < 4; i += 1) {
    const x = room.x + 21 + i * 59;
    ctx.fillStyle = "#242b26";
    ctx.fillRect(x, room.y + 40, 50, 68);
    ctx.strokeStyle = "#697167";
    ctx.lineWidth = 2;
    for (let bar = 0; bar < 5; bar += 1) {
      ctx.beginPath(); ctx.moveTo(x + 8 + bar * 9, room.y + 41); ctx.lineTo(x + 8 + bar * 9, room.y + 107); ctx.stroke();
    }
    ctx.fillStyle = "#555f53";
    ctx.fillRect(x + 3, room.y + 100, 44, 8);
  }
}

function drawTables(room) {
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = room.x + 31 + col * 78;
      const y = room.y + 55 + row * 63;
      ctx.fillStyle = "#161e19";
      ctx.fillRect(x + 3, y + 4, 52, 22);
      ctx.fillStyle = "#686452";
      ctx.fillRect(x, y, 52, 18);
      ctx.fillStyle = "#35372e";
      ctx.fillRect(x + 4, y + 3, 44, 11);
    }
  }
}

function drawExit() {
  ctx.fillStyle = "#111713";
  ctx.fillRect(859, 463, 53, 71);
  ctx.fillStyle = "#745a3c";
  ctx.fillRect(864, 468, 43, 60);
  ctx.strokeStyle = "#b79861";
  ctx.lineWidth = 3;
  ctx.strokeRect(867, 471, 37, 55);
  ctx.strokeStyle = "#b79861";
  for (let x = 874; x < 902; x += 9) {
    ctx.beginPath(); ctx.moveTo(x, 473); ctx.lineTo(x, 524); ctx.stroke();
  }
  ctx.fillStyle = "#e5b66d";
  ctx.beginPath(); ctx.arc(898, 498, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#cab17d";
  ctx.font = "9px 'DM Mono', monospace";
  ctx.fillText(state && state.player.keys >= 3 ? "OPEN" : "EXIT", 864, 545);
  if (state && state.player.keys >= 3) {
    ctx.fillStyle = "rgba(223, 180, 106, .16)";
    ctx.fillRect(858, 461, 55, 74);
  }
}

function drawKey(fragment) {
  if (fragment.taken) return;
  const pulse = 1 + Math.sin(performance.now() / 230) * .12;
  ctx.save();
  ctx.translate(fragment.x, fragment.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = "#e7bd65";
  ctx.shadowBlur = 13;
  ctx.strokeStyle = "#e9c879";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(-3, 0, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(12, 0); ctx.lineTo(12, 4); ctx.moveTo(8, 0); ctx.lineTo(8, 3); ctx.stroke();
  ctx.restore();
}

function drawActor(actor, infected) {
  if (actor.hidden || actor.caught) return;
  const { x, y, angle } = actor;
  const bob = Math.sin(actor.step) * 1.4;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(angle + Math.PI / 2);
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 5;
  const clothing = infected
    ? ["#666b52", "#4a5141", "#75694f"]
    : actor.role === ROLE.GUARD ? ["#273b39", "#3f554b", "#162522"] : ["#d3d0bf", "#e1ddd0", "#a29e8d"];
  const shirt = ctx.createLinearGradient(-9, 0, 9, 0);
  shirt.addColorStop(0, clothing[0]);
  shirt.addColorStop(.46, clothing[1]);
  shirt.addColorStop(1, clothing[2]);
  ctx.fillStyle = "#24241f";
  ctx.beginPath(); ctx.ellipse(-5, 11, 4.2, 10, -.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(5, 11, 4.2, 10, .12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1d201c";
  ctx.beginPath(); ctx.ellipse(-5, 20, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(5, 20, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.moveTo(-9, -4); ctx.quadraticCurveTo(-9, -10, -5, -11); ctx.lineTo(5, -11); ctx.quadraticCurveTo(10, -9, 9, -4); ctx.lineTo(8, 10); ctx.quadraticCurveTo(0, 13, -8, 10); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(240, 236, 212, .18)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(-4, 8); ctx.stroke();
  if (!infected && actor.role === ROLE.PRISONER) {
    ctx.strokeStyle = "rgba(59, 62, 54, .65)";
    ctx.lineWidth = 2;
    for (let yStripe = -5; yStripe < 8; yStripe += 5) {
      ctx.beginPath(); ctx.moveTo(-7, yStripe); ctx.lineTo(7, yStripe + 1); ctx.stroke();
    }
  } else if (!infected) {
    ctx.fillStyle = "#bca36e";
    ctx.fillRect(-2, -8, 4, 3);
    ctx.fillStyle = "#1b2825";
    ctx.fillRect(-9, -9, 18, 2);
  } else {
    ctx.strokeStyle = "rgba(123, 58, 47, .85)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, -7); ctx.lineTo(4, 1); ctx.stroke();
  }
  const skin = ctx.createLinearGradient(-5, -21, 5, -12);
  skin.addColorStop(0, "#c79471");
  skin.addColorStop(.55, "#e0b08a");
  skin.addColorStop(1, "#95644c");
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(0, -15, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(51, 38, 32, .75)";
  ctx.beginPath(); ctx.ellipse(0, -18, 5.6, 3.1, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#232724";
  ctx.beginPath(); ctx.arc(-2, -15, .7, 0, Math.PI * 2); ctx.arc(2, -15, .7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (actor.isPlayer) {
    ctx.strokeStyle = "#b5d394";
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 24, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (!infected) {
    ctx.fillStyle = "#e2a472";
    ctx.beginPath(); ctx.arc(0, -28, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawFloor();
  state?.fragments.forEach(drawKey);
  if (state) {
    state.zombies.forEach((zombie) => drawActor({ ...zombie, role: "infected", isPlayer: false, step: state.elapsed * 6 }, true));
    drawActor(state.opponent, false);
    drawActor(state.player, false);
    if (state.player.hidden) {
      ctx.fillStyle = "rgba(174, 202, 143, .82)";
      ctx.font = "11px 'DM Mono', monospace";
      ctx.fillText(`숨는 중 ${Math.ceil(state.player.hideTimer)}초`, state.player.x - 28, state.player.y - 34);
    }
    if (state.paused) {
      ctx.fillStyle = "rgba(7, 11, 9, .65)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e7eee7";
      ctx.textAlign = "center";
      ctx.font = "600 25px Manrope, sans-serif";
      ctx.fillText("일시 정지", W / 2, H / 2);
      ctx.font = "12px Manrope, sans-serif";
      ctx.fillText("ESC 키를 눌러 계속하기", W / 2, H / 2 + 26);
      ctx.textAlign = "left";
    }
  }
  const vignette = ctx.createRadialGradient(W / 2, H / 2, 170, W / 2, H / 2, 570);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, .54)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(215, 226, 201, .035)";
  for (let i = 0; i < 85; i += 1) {
    const x = (i * 139 + 41) % W;
    const y = (i * 83 + 17) % H;
    ctx.fillRect(x, y, 1, 1);
  }
}

function frame(timestamp) {
  const dt = Math.min((timestamp - previousTime) / 1000 || 0, .05);
  previousTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 1900);
}

function interact() {
  if (!state || !state.active) return;
  const actor = state.player;
  if (actor.hidden) {
    actor.hidden = false;
    actor.hideTimer = 0;
    showToast("사물함에서 나왔습니다.");
    return;
  }
  const locker = lockers.find((item) => actor.x > item.x - 25 && actor.x < item.x + item.w + 25 && actor.y > item.y - 25 && actor.y < item.y + item.h + 25);
  if (locker) {
    actor.hidden = true;
    actor.hideTimer = 10;
    showToast("사물함에 숨었습니다. 최대 10초");
  } else if (state.role === ROLE.PRISONER && actor.keys >= 3 && actor.x > 825 && actor.y > 450) {
    finishGame(ROLE.PRISONER, "escape");
  } else if (state.role === ROLE.GUARD && distance(actor, state.opponent) < 40) {
    showToast("죄수를 체포했습니다.");
  } else {
    showToast("근처에 사용할 수 있는 대상이 없습니다.");
  }
}

function playTone(frequency, duration) {
  if (!soundEnabled) return;
  try {
    audioContext = audioContext || new window.AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(.04, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    showToast("이 브라우저에서는 효과음을 재생할 수 없습니다.");
  }
}

document.querySelectorAll(".role-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".role-card").forEach((other) => {
      other.classList.remove("selected");
      other.setAttribute("aria-pressed", "false");
    });
    card.classList.add("selected");
    card.setAttribute("aria-pressed", "true");
    selectedRole = card.dataset.role;
  });
});

document.getElementById("start-button").addEventListener("click", startGame);
document.getElementById("restart-button").addEventListener("click", startGame);
document.getElementById("sound-toggle").addEventListener("click", (event) => {
  soundEnabled = !soundEnabled;
  event.currentTarget.setAttribute("aria-label", soundEnabled ? "효과음 끄기" : "효과음 켜기");
  showToast(soundEnabled ? "효과음이 켜졌습니다." : "효과음이 꺼졌습니다.");
});
document.getElementById("help-button").addEventListener("click", () => {
  showToast("WASD / 방향키 이동 · SHIFT 달리기 · E 숨기 · ESC 일시 정지");
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
  if (key === "escape" && state?.active) state.paused = !state.paused;
  if ((key === "e" || key === " ") && !event.repeat) interact();
  keysDown.add(key);
});
window.addEventListener("keyup", (event) => keysDown.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keysDown.clear());

draw();
requestAnimationFrame(frame);
