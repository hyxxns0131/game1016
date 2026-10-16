import { OnlineNet, LocalNet, SoloNet, onlineAvailable, MAX_PLAYERS } from './net.js';
import { GAME } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { EndingScene } from './scenes/EndingScene.js';
import { ENDINGS, getEnding, pickEnding, getSeenEndings, markEndingSeen } from './endings.js';
import { $, showScreen, toast } from './ui.js';
import { sfx } from './audio.js';
import { playIntro } from './intro.js';

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
if (params.has('autostart')) window.__game = game; // 개발/테스트용
game.scene.add('Game', GameScene);
game.scene.add('Ending', EndingScene);
game.scene.add('Boot', BootScene, true, {
  onReady: () => {
    assetsReady = true;
    if (pendingStart) { const f = pendingStart; pendingStart = null; f(); }
  },
});

// 브라우저는 사용자가 한 번 누르기 전엔 소리를 막는다 → 첫 입력 때 로비 BGM 시작
const unlockAudio = () => { sfx.ensure(); if (!sfx.music && !$('screen-lobby').classList.contains('hidden')) sfx.startMusic('lobby'); };
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio, { once: true });
// 버튼 딸깍
document.addEventListener('click', (e) => { if (e.target.closest('button')) sfx.click(); });

const bgmBtn = $('btn-bgm');
const syncBgmBtn = () => bgmBtn.classList.toggle('off', !sfx.musicOn);
bgmBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.ensure();
  sfx.setMusicOn(!sfx.musicOn);
  if (sfx.musicOn && !sfx.music) sfx.startMusic(game.scene.isActive('Game') ? 'game' : 'lobby');
  syncBgmBtn();
});
syncBgmBtn();
let lastPlayerCount = 0;

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
  ['btn-create', 'btn-join', 'btn-solo'].forEach((id) => ($(id).disabled = b));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showLobby() {
  stopPolling();
  matchRound = -1;
  game.scene.stop('Game');
  game.scene.stop('Ending');
  showScreen('screen-lobby');
  if (sfx.ctx) sfx.startMusic('lobby');
  lastPlayerCount = 0;
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
  renderWaiting();
}

/** 대기실: 참가자 목록 + 방장의 '게임 시작' 버튼 */
function renderWaiting() {
  if (!net || net.mode !== 'online' || $('lobby-wait').classList.contains('hidden')) return;
  const n = net.players.length;
  if (lastPlayerCount && n > lastPlayerCount) sfx.joinChime();
  else if (lastPlayerCount && n < lastPlayerCount) sfx.leaveChime();
  lastPlayerCount = n;
  $('wait-players').innerHTML = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const p = net.players[i];
    if (!p) return '<li class="empty">빈 자리</li>';
    const tags = [p.user_id === net.room.host_id ? '방장' : '', p.user_id === net.uid ? '나' : ''].filter(Boolean).join(' · ');
    return `<li><span>${esc(p.nickname)}</span>${tags ? `<small>${tags}</small>` : ''}</li>`;
  }).join('');
  $('wait-count').textContent = `${n} / ${MAX_PLAYERS}`;
  const start = $('btn-start');
  start.classList.toggle('hidden', !net.isHost);
  start.disabled = n < 2;
  start.textContent = n < 2 ? '2명 이상 모이면 시작할 수 있습니다' : `게임 시작 (${n}명 — 교도관 1 · 죄수 ${n - 1})`;
  $('wait-text').textContent = net.isHost
    ? (n < MAX_PLAYERS ? '초대 링크를 보내 생존자를 모으세요 (최대 4명)' : '방이 꽉 찼습니다. 시작하세요!')
    : '방장이 게임을 시작하길 기다리는 중…';
}

async function startGame() {
  $('btn-start').disabled = true;
  try {
    await net.startGame();
    net.send('start', {});
    startMatch();
  } catch (e) {
    toast(e.message);
    renderWaiting();
  }
}

/** 게임 시작 전 스토리 인트로 (개발용 autostart에선 생략) */
function intro() {
  return params.has('autostart') ? Promise.resolve() : playIntro();
}

async function createRoom() {
  const nick = getNick();
  if (!nick) return;
  setBusy(true); showError('');
  await intro();
  try {
    net = new OnlineNet();
    await net.init();
    await net.createRoom(nick);
    history.replaceState(null, '', `${location.pathname}#/room/${net.room.code}`);
    await net.subscribe();
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
  await intro();
  try {
    net = new OnlineNet();
    await net.init();
    await net.joinRoom(code, nick);
    await net.subscribe();
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
  net.on('start', check);
  net.on('left', check);
  net.on('state', () => {
    renderWaiting();
    if (!$('screen-result').classList.contains('hidden')) updateAgainButton();
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
      await net.heartbeat();
      maybeStart();
    } catch (e) { console.warn(e); }
  }, 2000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function startSolo() {
  sfx.ensure();
  let nick = $('nickname').value.trim();
  if (nick) { try { localStorage.setItem('zpb_nick', nick); } catch { /* 무시 */ } }
  if ($('btn-solo').disabled) return;
  setBusy(true);
  await intro();
  net = new SoloNet(nick);
  await net.startGame();
  const skip = Number(params.get('debugTime') || 0);
  if (skip) net.room.started_at = new Date(Date.parse(net.room.started_at) - skip * 1000).toISOString();
  startMatch();
}

async function startLocal() {
  sfx.ensure();
  net = new LocalNet();
  await net.startGame();
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
  const prisonerCount = net.players.filter((p) => p.role === 'prisoner').length;
  $('reveal-goal').textContent = role === 'prisoner'
    ? `열쇠 조각 3개를 모아 운동장 동쪽 정문으로 탈출하라.${prisonerCount > 1 ? ` 동료 죄수 ${prisonerCount - 1}명과 함께.` : ''}`
    : prisonerCount > 1 ? `10분 동안 죄수 ${prisonerCount}명을 막아라. 과반이 탈출하면 패배.` : '10분 동안 죄수의 탈출을 막아라.';
  $('reveal-skills').innerHTML = role === 'prisoner'
    ? 'X 달리기 (스태미나 · 소음) · Space 점프 (탁자 넘기 · 공중에선 안 잡힘) · Z 앉기 (조용히)<br>C 사물함에 숨기 (최대 10초 · 교도관·좀비에게 안 보임)<br>교도관에게 잡히면 감방으로 끌려가고 열쇠 1개를 떨어뜨린다'
    : 'C 문 잠그기 (동시에 최대 3개 · 쿨다운) · 넓은 손전등 시야<br>X 달리기 · Space 점프 · Z 앉기<br>죄수와 접촉하면 체포 → 감방으로 돌려보냄';
  const others = net.players.filter((p) => p.user_id !== me.user_id);
  $('reveal-vs').textContent = local
    ? `P2 (WASD) = ${ROLE_KO[others[0].role]}  ·  좀비에게 잡히면 아웃`
    : `${others.map((p) => `${p.nickname} (${ROLE_KO[p.role]})`).join(' · ')}  ·  좀비에게 잡히면 아웃`;
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
/** 이 화면을 보고 있는 사람(온라인: 나, 혼자 하기/로컬: P1) 기준 */
function viewer(state) {
  const myId = net.mode === 'online' ? net.uid : net.me.user_id;
  const me = state.players.find((p) => p.user_id === myId);
  return { me, iWon: !!me?.won };
}

/** 엔딩 컷의 대체 장면(좀비 버전)을 고르기 위한, 보는 사람 기준 종료 사유 */
function viewerReason(state) {
  const { me } = viewer(state);
  const ps = state.players;
  const anyEscaped = ps.some((p) => p.status === 'escaped');
  const anyDead = ps.some((p) => p.role === 'prisoner' && p.status === 'dead');
  if (me?.status === 'dead' || state.room.end_reason === 'guard_down') return 'zombie';
  if (me?.role === 'guard' && me.won && anyDead && !anyEscaped) return 'zombie';
  return state.room.end_reason;
}

async function onGameOver(state) {
  game.scene.stop('Game');
  if (net.mode === 'online') startPolling(); // 엔딩 컷신 동안에도 하트비트 유지(방에서 빠지지 않게)
  showScreen(null);
  const room = state.room;
  const { me, iWon } = viewer(state);
  // 엔딩은 '내' 역할과 승패로 고른다 → 졌으면 LOSE 엔딩
  const ending = room.end_reason !== 'guard_left' && me && me.status !== 'left' ? pickEnding(me.role, iWon) : null;
  if (!ending) { showResult(state); return; }

  const header = iWon ? { text: '승리 · WIN', cls: 'win' } : { text: '패배 · LOSE', cls: 'lose' };
  markEndingSeen(ending.id);
  await document.fonts.ready;
  game.scene.start('Ending', {
    ending, endReason: viewerReason(state), header,
    onDone: () => { game.scene.stop('Ending'); showResult(state); },
  });
}

function reasonText(state) {
  const { me } = viewer(state);
  const prisoners = state.players.filter((p) => p.role === 'prisoner');
  const escaped = prisoners.filter((p) => p.status === 'escaped').length;
  const head = {
    resolved: `죄수 ${prisoners.length}명 중 ${escaped}명 탈출.`,
    time: `10분이 지났다. 죄수 ${prisoners.length}명 중 ${escaped}명 탈출.`,
    guard_down: '교도관이 좀비에게 쓰러졌다. 남은 죄수들은 자유다.',
    guard_left: '교도관의 연결이 끊어졌다.',
  }[state.room.end_reason] || '';
  const mine = { escaped: '나는 정문을 열고 탈출했다!', dead: '나는 좀비에게 물렸다…' }[me?.status]
    || (me?.role === 'guard' && me.won ? '교도소를 지켜냈다.' : '');
  return `${head} ${mine}`.trim();
}

function renderRoster(state) {
  const ST = { alive: '생존', escaped: '🚪 탈출', dead: '☠ 사망', left: '⚠ 이탈' };
  $('result-roster').innerHTML = state.players.filter((p) => p.role).map((p) =>
    `<li class="${p.won ? 'win' : 'lose'}"><span class="role ${p.role}">${ROLE_KO[p.role]}</span><span class="nm">${esc(p.nickname)}</span><span class="st">${ST[p.status] || ''}</span><b>${p.won ? 'WIN' : 'LOSE'}</b></li>`).join('');
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
    cap.textContent = open ? `「${e.title}」 — ${ROLE_KO[e.role]} ${e.win ? '승리' : '패배'}` : '??? — 아직 보지 못한 엔딩';
    d.appendChild(cap);
    list.appendChild(d);
  });
}

function showResult(state) {
  const { me, iWon } = viewer(state);
  const mine = $('result-mine');
  mine.textContent = iWon ? 'WIN' : 'LOSE';
  mine.className = `result-mine ${iWon ? 'win' : 'lose'}`;
  $('result-title').textContent = me ? `${ROLE_KO[me.role]} ${me.nickname} — ${iWon ? '승리' : '패배'}` : '';
  $('result-reason').textContent = reasonText(state);
  renderRoster(state);
  renderDex();
  showScreen('screen-result');
  setTimeout(() => { if (!$('screen-result').classList.contains('hidden')) sfx.startMusic('lobby'); }, 2500);
  $('result-wait').textContent = '';
  updateAgainButton();
  if (net.mode === 'online') startPolling();
}

function updateAgainButton() {
  const btn = $('btn-again');
  if (net.mode !== 'online') { btn.disabled = false; $('result-wait').textContent = ''; return; }
  const n = net.players.length;
  btn.disabled = !net.isHost || n < 2;
  $('result-wait').textContent = n < 2
    ? '다른 사람이 모두 방을 나갔습니다. 초대 링크로 다시 모으세요.'
    : net.isHost
      ? `"다시 하기"를 누르면 같은 방(${n}명)에서 역할을 다시 뽑습니다. 새 친구도 초대 링크로 들어올 수 있어요.`
      : `방장이 다시 시작하길 기다리는 중… (${n}명)`;
}

async function again() {
  $('btn-again').disabled = true;
  try {
    await net.startGame();
    if (net.mode === 'online') net.send('start', {});
    startMatch();
  } catch (e) {
    toast(e.message);
    updateAgainButton();
  }
}

async function toLobby() {
  stopPolling();
  if (net) { net.send('left', {}); await net.leave(); }
  net = null;
  history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------------------------------------------------------------- 바인딩
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$('btn-solo').addEventListener('click', startSolo);
const howto = (open) => $('howto').classList.toggle('hidden', !open);
$('btn-howto').addEventListener('click', () => howto(true));
$('btn-howto-close').addEventListener('click', () => howto(false));
$('howto').addEventListener('click', (e) => { if (e.target.id === 'howto') howto(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') howto(false); });
$('btn-again').addEventListener('click', again);
$('btn-start').addEventListener('click', startGame);
$('btn-lobby').addEventListener('click', toLobby);
$('btn-leave').addEventListener('click', toLobby);
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); toast('초대 링크를 복사했습니다'); }
  catch { $('invite-link').select(); document.execCommand('copy'); toast('초대 링크를 복사했습니다'); }
});
$('nickname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (!onlineAvailable ? startSolo : roomCodeFromUrl() ? joinRoom : createRoom)();
});
window.addEventListener('hashchange', () => { if (!net) showLobby(); });

showLobby();

// 개발/테스트용: ?autostart=local 로 바로 로컬 대전, ?ending=escape&reason=zombie 로 엔딩 미리보기
if (params.get('autostart') === 'local') startLocal();
if (params.get('autostart') === 'solo') startSolo();
if (params.get('ending')) {
  pendingStart = null;
  const run = () => {
    net = new LocalNet();
    const ending = getEnding(params.get('ending'));
    // P1 시점: 엔딩의 역할/승패를 P1에게 준다
    net.players[0].role = ending.role;
    net.players[1].role = ending.role === 'prisoner' ? 'guard' : 'prisoner';
    net.players[0].won = ending.win; net.players[1].won = !ending.win;
    if (params.get('reason') === 'zombie') net.players[0].status = ending.win ? 'alive' : 'dead';
    onGameOver({ room: { ...net.room, status: 'finished', ending: ending.id, end_reason: 'resolved' }, players: net.players });
  };
  if (assetsReady) run(); else pendingStart = run;
}
