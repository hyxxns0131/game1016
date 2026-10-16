import { OnlineNet, LocalNet, onlineAvailable } from './net.js';
import { GAME } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { EndingScene } from './scenes/EndingScene.js';
import { ENDINGS, getEnding, getSeenEndings, markEndingSeen } from './endings.js';
import { $, showScreen, toast } from './ui.js';
import { sfx } from './audio.js';

const ROLE_KO = { prisoner: '죄수', guard: '교도관' };
const params = new URLSearchParams(location.search);

let net = null;
let pollTimer = null;
let matchRound = -1;
let revealTimer = null;
let assetsReady = false;
let pendingStart = null;

// ---------------------------------------------------------------- Phaser
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true },
});
game.scene.add('Game', GameScene);
game.scene.add('Ending', EndingScene);
game.scene.add('Boot', BootScene, true, {
  onReady: () => {
    assetsReady = true;
    if (pendingStart) { const f = pendingStart; pendingStart = null; f(); }
  },
});

document.addEventListener('pointerdown', () => sfx.ensure(), { once: false });
document.addEventListener('keydown', () => sfx.ensure(), { once: true });

// ---------------------------------------------------------------- 로비
function roomCodeFromUrl() {
  const m = location.hash.match(/room\/([A-Za-z0-9]+)/) || location.pathname.match(/\/room\/([A-Za-z0-9]+)/);
  return (m && m[1].toUpperCase()) || (params.get('room') || '').toUpperCase() || null;
}

function getNick() {
  const v = $('nickname').value.trim();
  if (!v) { showError('닉네임을 입력해주세요.'); $('nickname').focus(); return null; }
  try { localStorage.setItem('zpb_nick', v); } catch { /* 무시 */ }
  return v;
}

function showError(msg) {
  const el = $('lobby-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function setBusy(b) {
  ['btn-create', 'btn-join'].forEach((id) => ($(id).disabled = b));
}

function showLobby() {
  stopPolling();
  matchRound = -1;
  game.scene.stop('Game');
  game.scene.stop('Ending');
  showScreen('screen-lobby');
  $('lobby-main').classList.remove('hidden');
  $('lobby-wait').classList.add('hidden');
  showError('');
  setBusy(false);

  const code = roomCodeFromUrl();
  try { $('nickname').value = localStorage.getItem('zpb_nick') || ''; } catch { /* 무시 */ }
  $('btn-join').classList.toggle('hidden', !code);
  $('join-hint').classList.toggle('hidden', !code);
  if (code) $('join-hint').innerHTML = `초대받은 방 <b>${code}</b> — 닉네임을 입력하고 입장하세요.`;
  $('btn-create').classList.toggle('btn-primary', !code);
  if (!onlineAvailable) {
    $('online-warn').classList.remove('hidden');
    $('btn-create').disabled = true;
    $('btn-join').disabled = true;
  }
}

function showWaiting() {
  $('lobby-main').classList.add('hidden');
  $('lobby-wait').classList.remove('hidden');
  const link = `${location.origin}${location.pathname}#/room/${net.room.code}`;
  $('invite-link').value = link;
  $('room-code').textContent = net.room.code;
  $('wait-text').textContent = '상대 생존자를 기다리는 중…';
}

async function createRoom() {
  const nick = getNick();
  if (!nick) return;
  setBusy(true); showError('');
  try {
    net = new OnlineNet();
    await net.init();
    await net.createRoom(nick);
    history.replaceState(null, '', `${location.pathname}#/room/${net.room.code}`);
    await net.subscribe(nick);
    bindRoom();
    showWaiting();
    startPolling();
  } catch (e) {
    console.error(e);
    showError(e.message);
    setBusy(false);
  }
}

async function joinRoom() {
  const nick = getNick();
  if (!nick) return;
  const code = roomCodeFromUrl();
  setBusy(true); showError('');
  try {
    net = new OnlineNet();
    await net.init();
    await net.joinRoom(code, nick);
    await net.subscribe(nick);
    bindRoom();
    net.send('joined', {});
    if (net.room.status === 'playing') startMatch();
    else { showWaiting(); startPolling(); }
  } catch (e) {
    console.error(e);
    showError(e.message);
    setBusy(false);
  }
}

function bindRoom() {
  const check = async () => {
    try {
      await net.refresh();
      maybeStart();
    } catch (e) { console.warn(e); }
  };
  net.on('joined', check);
  net.on('rematch', check);
  net.on('presence-join', (id) => {
    if (id !== net.uid && !$('lobby-wait').classList.contains('hidden')) $('wait-text').textContent = '상대가 접속했다!';
  });
  net.on('presence-leave', (id) => {
    if (id !== net.uid && !$('screen-result').classList.contains('hidden')) updateAgainButton();
  });
}

function maybeStart() {
  if (net.room.status === 'playing' && net.room.round !== matchRound) startMatch();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!net || net.mode !== 'online') return;
    try {
      await net.refresh();
      maybeStart();
      if (!$('screen-result').classList.contains('hidden')) updateAgainButton();
    } catch (e) { console.warn(e); }
  }, 2000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function startLocal() {
  sfx.ensure();
  net = new LocalNet();
  await net.assignRoles();
  const skip = Number(params.get('debugTime') || 0);
  if (skip) net.room.started_at = new Date(Date.parse(net.room.started_at) - skip * 1000).toISOString();
  startMatch();
}

// ---------------------------------------------------------------- 역할 공개 → 게임
function startMatch() {
  if (!assetsReady) { pendingStart = startMatch; return; }
  if (matchRound === net.room.round) return;
  matchRound = net.room.round;
  stopPolling();
  clearInterval(revealTimer);

  // 역할 공개 화면
  const me = net.me;
  const local = net.mode === 'local';
  const role = me.role;
  $('reveal-img').src = `assets/img/portrait_${role}.jpg`;
  $('reveal-label').textContent = local ? 'P1 (방향키)의 역할 · 개발용 로컬 테스트' : `${me.nickname}, 당신의 역할은`;
  const roleEl = $('reveal-role');
  roleEl.textContent = ROLE_KO[role];
  roleEl.className = `reveal-role ${role}`;
  $('reveal-goal').textContent = role === 'prisoner'
    ? '열쇠 조각 3개를 모아 운동장 동쪽 정문으로 탈출하라.'
    : '10분 동안 죄수의 탈출을 막아라.';
  $('reveal-skills').innerHTML = role === 'prisoner'
    ? 'X 달리기 (스태미나 · 소음) · Space 점프 (탁자 넘기 · 공중에선 안 잡힘) · Z 앉기 (조용히)<br>C 사물함에 숨기 (최대 10초 · 교도관·좀비에게 안 보임)<br>교도관에게 잡히면 감방으로 끌려가고 열쇠 1개를 떨어뜨린다'
    : 'C 문 잠그기 (동시에 최대 3개 · 쿨다운) · 넓은 손전등 시야<br>X 달리기 · Space 점프 · Z 앉기<br>죄수와 접촉하면 체포 → 감방으로 돌려보냄';
  $('reveal-vs').textContent = local
    ? `P2 (WASD) = ${ROLE_KO[net.opponent.role]}  ·  좀비에게 잡히면 즉시 패배`
    : `상대: ${net.opponent.nickname} (${ROLE_KO[net.opponent.role]})  ·  좀비에게 잡히면 즉시 패배`;
  $('countdown').classList.add('hidden');
  showScreen('screen-reveal');
  sfx.slam();

  game.scene.stop('Ending');
  game.scene.stop('Game');
  game.scene.start('Game', { net, onGameOver });

  let lastShown = null;
  revealTimer = setInterval(() => {
    const t = net.startedAtMs - net.serverNow();
    const cd = $('countdown');
    if (t > GAME.COUNTDOWN_SECONDS * 1000) return;
    if (t > 0) {
      const n = Math.ceil(t / 1000);
      if (n !== lastShown) {
        lastShown = n;
        cd.classList.remove('hidden');
        cd.innerHTML = `<span>${n}</span>`;
        sfx.beep();
      }
      return;
    }
    if (lastShown !== 'go') {
      lastShown = 'go';
      cd.classList.remove('hidden');
      cd.innerHTML = '<span style="font-size:110px">생존하라</span>';
      sfx.go();
      setTimeout(() => showScreen(null), 700);
      clearInterval(revealTimer);
    }
  }, 50);
}

// ---------------------------------------------------------------- 엔딩 → 결과
async function onGameOver(state) {
  game.scene.stop('Game');
  showScreen(null);
  const room = state.room;
  const ending = room.ending && room.end_reason !== 'disconnect' ? getEnding(room.ending) : null;
  if (!ending) { showResult(state); return; }

  const winner = state.players.find((p) => p.user_id === room.winner_id);
  const header = net.mode === 'local'
    ? { text: `${ROLE_KO[winner.role]} 승리`, cls: 'win' }
    : room.winner_id === net.uid ? { text: '승리', cls: 'win' } : { text: '패배', cls: 'lose' };
  markEndingSeen(ending.id);
  await document.fonts.ready;
  game.scene.start('Ending', {
    ending, endReason: room.end_reason, header,
    onDone: () => { game.scene.stop('Ending'); showResult(state); },
  });
}

function reasonText(state) {
  const room = state.room;
  const loser = state.players.find((p) => p.user_id !== room.winner_id);
  switch (room.end_reason) {
    case 'escape': return '죄수가 열쇠 조각 3개로 정문을 열고 탈출했다.';
    case 'time': return '10분을 버텼다. 교대 시간이 되었다.';
    case 'zombie': return `${loser?.nickname ?? '상대'}(${ROLE_KO[loser?.role] ?? ''})이(가) 좀비에게 잡혔다.`;
    case 'disconnect': return '상대의 연결이 끊어졌다.';
    default: return '';
  }
}

function renderDex() {
  const seen = new Set(getSeenEndings());
  $('dex-count').textContent = `(${ENDINGS.filter((e) => seen.has(e.id)).length}/${ENDINGS.length})`;
  const list = $('dex-list');
  list.innerHTML = '';
  ENDINGS.forEach((e) => {
    const d = document.createElement('div');
    const open = seen.has(e.id);
    d.className = `dex-item${open ? '' : ' locked'}`;
    if (open) d.style.backgroundImage = `url(assets/img/${e.thumb}.jpg)`;
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = open ? `「${e.title}」 — ${ROLE_KO[e.winnerRole]} 승리` : '??? — 아직 보지 못한 엔딩';
    d.appendChild(cap);
    list.appendChild(d);
  });
}

function showResult(state) {
  const room = state.room;
  const winner = state.players.find((p) => p.user_id === room.winner_id);
  const mine = $('result-mine');
  if (net.mode === 'local') {
    mine.textContent = `${ROLE_KO[winner.role]} 승리`;
    mine.className = 'result-mine win';
  } else {
    const won = room.winner_id === net.uid;
    mine.textContent = won ? '승리' : '패배';
    mine.className = `result-mine ${won ? 'win' : 'lose'}`;
  }
  $('result-title').textContent = winner ? `${winner.nickname} (${ROLE_KO[winner.role]}) 승리` : '';
  $('result-reason').textContent = reasonText(state);
  renderDex();
  showScreen('screen-result');
  $('result-wait').textContent = '';
  updateAgainButton();
  if (net.mode === 'online') startPolling();
}

function updateAgainButton() {
  const btn = $('btn-again');
  if (net.mode === 'local') { btn.disabled = false; return; }
  const ok = net.opponentOnline();
  btn.disabled = !ok;
  $('result-wait').textContent = ok ? '둘 중 누구든 "다시 하기"를 누르면 같은 방에서 역할을 다시 뽑습니다.' : '상대가 방을 나갔습니다.';
}

async function again() {
  $('btn-again').disabled = true;
  try {
    await net.assignRoles();
    if (net.mode === 'online') net.send('rematch', {});
    startMatch();
  } catch (e) {
    toast(e.message);
    updateAgainButton();
  }
}

async function toLobby() {
  stopPolling();
  if (net) await net.leave();
  net = null;
  history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------------------------------------------------------------- 바인딩
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-again').addEventListener('click', again);
$('btn-lobby').addEventListener('click', toLobby);
$('btn-leave').addEventListener('click', toLobby);
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); toast('초대 링크를 복사했습니다'); }
  catch { $('invite-link').select(); document.execCommand('copy'); toast('초대 링크를 복사했습니다'); }
});
$('nickname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && onlineAvailable) (roomCodeFromUrl() ? joinRoom : createRoom)();
});
window.addEventListener('hashchange', () => { if (!net) showLobby(); });

showLobby();

// 개발/테스트용: ?autostart=local 로 바로 로컬 대전, ?ending=escape&reason=zombie 로 엔딩 미리보기
if (params.get('autostart') === 'local') startLocal();
if (params.get('ending')) {
  pendingStart = null;
  const run = () => {
    net = new LocalNet();
    net.players[0].role = 'prisoner'; net.players[1].role = 'guard';
    const ending = getEnding(params.get('ending'));
    const winnerRole = ending.winnerRole;
    const winner = net.players.find((p) => p.role === winnerRole);
    onGameOver({ room: { ...net.room, status: 'finished', ending: ending.id, end_reason: params.get('reason') || 'escape', winner_id: winner.user_id }, players: net.players });
  };
  if (assetsReady) run(); else pendingStart = run;
}
