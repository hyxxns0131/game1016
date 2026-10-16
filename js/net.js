// 네트워크 계층. OnlineNet(Supabase)과 LocalNet(한 키보드 2인)이 같은 인터페이스를 가진다.
//   net.uid / net.room / net.players / net.isHost / net.serverNow()
//   net.send(type, data) / net.on(type, cb)
//   net.endGame(reason, actorId) → Promise<state>
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.js';
import { GAME } from './config.js';

export const onlineAvailable = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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
    ROOM_FULL: '방이 가득 찼습니다.',
    ROOM_CLOSED: '이미 게임이 진행 중인 방입니다.',
    NEED_TWO_PLAYERS: '상대가 방에 없습니다.',
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
    this.presentIds = new Set();
  }

  async init() {
    // sessionStorage를 쓰면 같은 브라우저의 탭 두 개가 서로 다른 익명 유저가 된다(테스트 편의).
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
  get opponent() { return this.players.find((p) => p.user_id !== this.uid); }
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
    return data;
  }

  createRoom(nickname) { return this.rpc('create_room', { p_nickname: nickname }); }
  joinRoom(code, nickname) { return this.rpc('join_room', { p_code: code, p_nickname: nickname }); }
  refresh() { return this.rpc('get_room_state', { p_room_id: this.room.id }); }
  assignRoles() { return this.rpc('assign_roles', { p_room_id: this.room.id }); }
  endGame(reason) { return this.rpc('end_game', { p_room_id: this.room.id, p_reason: reason }); }

  subscribe(nickname) {
    return new Promise((resolve, reject) => {
      const ch = this.sb.channel('zpb-' + this.room.code, {
        config: { broadcast: { self: false, ack: false }, presence: { key: this.uid } },
      });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => this.emit(payload.t, payload.d));
      ch.on('presence', { event: 'sync' }, () => {
        const before = this.presentIds;
        this.presentIds = new Set(Object.keys(ch.presenceState()));
        for (const id of before) if (!this.presentIds.has(id)) this.emit('presence-leave', id);
        for (const id of this.presentIds) if (!before.has(id)) this.emit('presence-join', id);
      });
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ nickname, at: Date.now() });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error('실시간 서버 연결에 실패했습니다.'));
        }
      });
      this.channel = ch;
    });
  }

  opponentOnline() {
    const o = this.opponent;
    return Boolean(o && this.presentIds.has(o.user_id));
  }

  send(type, data) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'm', payload: { t: type, d: data } });
  }

  async leave() {
    if (this.channel) await this.sb.removeChannel(this.channel);
    this.channel = null;
    this.room = null;
    this.players = [];
    this.presentIds = new Set();
  }
}

export class LocalNet extends Emitter {
  constructor() {
    super();
    this.mode = 'local';
    this.uid = 'p1';
    this.players = [
      { user_id: 'p1', nickname: 'P1', role: null },
      { user_id: 'p2', nickname: 'P2', role: null },
    ];
    this.room = { id: 'local-' + Math.random().toString(36).slice(2), code: 'LOCAL', host_id: 'p1', status: 'waiting', round: 0 };
  }
  get isHost() { return true; }
  get me() { return this.players[0]; }
  get opponent() { return this.players[1]; }
  get startedAtMs() { return this.room.started_at ? Date.parse(this.room.started_at) : 0; }
  serverNow() { return Date.now(); }
  opponentOnline() { return true; }
  send() {}
  async leave() {}

  state() { return { room: { ...this.room }, players: this.players.map((p) => ({ ...p })), server_now: new Date().toISOString() }; }

  async assignRoles() {
    if (this.room.status === 'playing') return this.state();
    const first = Math.random() < 0.5 ? 0 : 1;
    this.players.forEach((p, i) => (p.role = i === first ? 'prisoner' : 'guard'));
    const delay = (GAME.REVEAL_SECONDS + GAME.COUNTDOWN_SECONDS + 0.5) * 1000;
    Object.assign(this.room, {
      status: 'playing', started_at: new Date(Date.now() + delay).toISOString(),
      winner_id: null, end_reason: null, ending: null, round: this.room.round + 1,
    });
    return this.state();
  }

  /** end_game SQL 함수와 같은 규칙. actorId = 호출한(=잡힌/탈출한) 플레이어 */
  async endGame(reason, actorId) {
    if (this.room.status !== 'playing') return this.state();
    const me = this.players.find((p) => p.user_id === actorId);
    const other = this.players.find((p) => p.user_id !== actorId);
    const prisoner = this.players.find((p) => p.role === 'prisoner');
    const guard = this.players.find((p) => p.role === 'guard');
    let winner, ending;
    if (reason === 'escape') { winner = prisoner; ending = 'escape'; }
    else if (reason === 'time') { winner = guard; ending = 'last_shift'; }
    else if (reason === 'zombie') { winner = other; ending = other.role === 'prisoner' ? 'escape' : 'last_shift'; }
    else { winner = me; ending = null; }
    Object.assign(this.room, { status: 'finished', winner_id: winner.user_id, end_reason: reason, ending });
    return this.state();
  }
}
