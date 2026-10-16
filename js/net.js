// 네트워크 계층. OnlineNet(Supabase)과 LocalNet(한 키보드 2인)/SoloNet(AI)이 같은 인터페이스를 가진다.
//   net.uid / net.room / net.players / net.isHost / net.serverNow()
//   net.send(type, data) / net.on(type, cb)
//   net.startGame() / net.reportEscape(uid) / net.reportDeath(uid) / net.timeUp() → Promise<state>
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.js';
import { GAME } from './config.js';

export const onlineAvailable = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MAX_PLAYERS = 4;

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, cb) { (this.handlers[type] ||= []).push(cb); return () => this.off(type, cb); }
  off(type, cb) { this.handlers[type] = (this.handlers[type] || []).filter((h) => h !== cb); }
  emit(type, ...args) { (this.handlers[type] || []).slice().forEach((h) => h(...args)); }
  clearHandlers(types) { types.forEach((t) => delete this.handlers[t]); }
}

function friendlyError(msg) {
  const map = {
    ROOM_NOT_FOUND: '존재하지 않는 방입니다. 링크를 확인해주세요.',
    ROOM_FULL: `방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)`,
    ROOM_CLOSED: '이미 게임이 진행 중인 방입니다. 판이 끝나면 다시 들어와 주세요.',
    NEED_TWO_PLAYERS: '2명 이상 모여야 시작할 수 있습니다.',
    ONLY_HOST: '방장만 게임을 시작할 수 있습니다.',
    NOT_MEMBER: '이 방의 참가자가 아닙니다.',
  };
  for (const k in map) if (msg.includes(k)) return map[k];
  if (/anonymous/i.test(msg)) return 'Supabase에서 Anonymous sign-in이 꺼져 있습니다. 대시보드에서 활성화해주세요.';
  if (/function .* does not exist|Could not find the function/i.test(msg)) return 'DB 함수가 없습니다. supabase/schema.sql을 실행했는지 확인해주세요.';
  return msg;
}

export class OnlineNet extends Emitter {
  constructor() {
    super();
    this.mode = 'online';
    this.offset = 0;
    this.room = null;
    this.players = [];
  }

  async init() {
    // sessionStorage를 쓰면 같은 브라우저의 탭 여러 개가 서로 다른 익명 유저가 된다(테스트 편의).
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: window.sessionStorage, storageKey: 'zpb-auth', persistSession: true },
    });
    const { data } = await this.sb.auth.getSession();
    let user = data.session?.user;
    if (!user) {
      const res = await this.sb.auth.signInAnonymously();
      if (res.error) throw new Error(friendlyError(res.error.message));
      user = res.data.user;
    }
    this.uid = user.id;
  }

  get isHost() { return this.room?.host_id === this.uid; }
  get me() { return this.players.find((p) => p.user_id === this.uid); }
  get others() { return this.players.filter((p) => p.user_id !== this.uid); }
  get startedAtMs() { return this.room?.started_at ? Date.parse(this.room.started_at) : 0; }
  serverNow() { return Date.now() + this.offset; }

  async rpc(name, args) {
    const t0 = Date.now();
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw new Error(friendlyError(error.message));
    const t1 = Date.now();
    this.offset = Date.parse(data.server_now) - (t0 + t1) / 2;
    this.room = data.room;
    this.players = data.players;
    this.emit('state', data);
    return data;
  }

  createRoom(nickname) { return this.rpc('create_room', { p_nickname: nickname }); }
  joinRoom(code, nickname) { return this.rpc('join_room', { p_code: code, p_nickname: nickname }); }
  heartbeat() { return this.rpc('heartbeat', { p_room_id: this.room.id }); }
  refresh() { return this.heartbeat(); }
  startGame() { return this.rpc('start_game', { p_room_id: this.room.id }); }
  reportEscape() { return this.rpc('report_escape', { p_room_id: this.room.id }); }
  reportDeath() { return this.rpc('report_death', { p_room_id: this.room.id }); }
  timeUp() { return this.rpc('time_up', { p_room_id: this.room.id }); }

  subscribe() {
    return new Promise((resolve, reject) => {
      const ch = this.sb.channel('zpb-' + this.room.code, {
        config: { broadcast: { self: false, ack: false } },
      });
      // 모든 메시지에 보낸 사람(uid)을 붙인다 → 여러 명의 위치를 구분
      ch.on('broadcast', { event: 'm' }, ({ payload }) => this.emit(payload.t, payload.d, payload.u));
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('실시간 서버 연결에 실패했습니다.'));
      });
      this.channel = ch;
    });
  }

  send(type, data) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'm', payload: { t: type, d: data, u: this.uid } });
  }

  async leave() {
    if (this.room) { try { await this.sb.rpc('leave_room', { p_room_id: this.room.id }); } catch { /* 무시 */ } }
    if (this.channel) await this.sb.removeChannel(this.channel);
    this.channel = null;
    this.room = null;
    this.players = [];
  }
}

/** 서버 SQL(_finish / _check_end)과 같은 규칙을 브라우저 안에서 돌린다 */
export class LocalNet extends Emitter {
  constructor() {
    super();
    this.mode = 'local';
    this.uid = 'p1';
    this.players = [
      { user_id: 'p1', nickname: 'P1', role: null, status: 'alive', won: null },
      { user_id: 'p2', nickname: 'P2', role: null, status: 'alive', won: null },
    ];
    this.room = { id: 'local-' + Math.random().toString(36).slice(2), code: 'LOCAL', host_id: 'p1', status: 'waiting', round: 0 };
  }
  get isHost() { return true; }
  get me() { return this.players[0]; }
  get others() { return this.players.slice(1); }
  get startedAtMs() { return this.room.started_at ? Date.parse(this.room.started_at) : 0; }
  serverNow() { return Date.now(); }
  send() {}
  async leave() {}
  async heartbeat() { return this.state(); }
  async refresh() { return this.state(); }

  state() { return { room: { ...this.room }, players: this.players.map((p) => ({ ...p })), server_now: new Date().toISOString() }; }

  assignRoles() {
    const guard = Math.floor(Math.random() * this.players.length);
    this.players.forEach((p, i) => (p.role = i === guard ? 'guard' : 'prisoner'));
  }

  async startGame() {
    if (this.room.status === 'playing') return this.state();
    this.assignRoles();
    this.players.forEach((p) => { p.status = 'alive'; p.won = null; });
    const delay = (GAME.REVEAL_SECONDS + GAME.COUNTDOWN_SECONDS + 0.5) * 1000;
    Object.assign(this.room, {
      status: 'playing', started_at: new Date(Date.now() + delay).toISOString(),
      end_reason: null, ending: null, round: this.room.round + 1,
    });
    return this.state();
  }

  async reportEscape(uid) {
    const p = this.players.find((q) => q.user_id === uid);
    if (this.room.status === 'playing' && p?.role === 'prisoner' && p.status === 'alive') { p.status = 'escaped'; this.checkEnd(); }
    return this.state();
  }

  async reportDeath(uid) {
    const p = this.players.find((q) => q.user_id === uid);
    if (this.room.status === 'playing' && p?.status === 'alive') { p.status = 'dead'; this.checkEnd(); }
    return this.state();
  }

  async timeUp() {
    if (this.room.status === 'playing') this.finish('time');
    return this.state();
  }

  checkEnd() {
    const guard = this.players.find((p) => p.role === 'guard');
    const alive = this.players.filter((p) => p.role === 'prisoner' && p.status === 'alive').length;
    if (guard.status === 'dead') this.finish('guard_down');
    else if (alive === 0) this.finish('resolved');
  }

  finish(reason) {
    const prisoners = this.players.filter((p) => p.role === 'prisoner');
    const escaped = prisoners.filter((p) => p.status === 'escaped').length;
    const guardDown = reason === 'guard_down' || reason === 'guard_left';
    for (const p of this.players) {
      p.won = p.role === 'prisoner'
        ? p.status === 'escaped' || (p.status === 'alive' && guardDown)
        : p.status === 'alive' && !guardDown && escaped * 2 < prisoners.length;
    }
    const guardWon = this.players.some((p) => p.role === 'guard' && p.won);
    Object.assign(this.room, { status: 'finished', end_reason: reason, ending: guardWon ? 'last_shift' : 'escape' });
  }
}

/** 혼자 하기: 나는 죄수, 상대는 AI 교도관. 서버 없이 브라우저 안에서만 돈다. */
export class SoloNet extends LocalNet {
  constructor(nickname) {
    super();
    this.mode = 'solo';
    this.players = [
      { user_id: 'p1', nickname: nickname || '생존자', role: null, status: 'alive', won: null },
      { user_id: 'ai', nickname: 'AI 교도관', role: null, status: 'alive', won: null },
    ];
  }

  assignRoles() {
    this.players[0].role = 'prisoner';
    this.players[1].role = 'guard';
  }
}
