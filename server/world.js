// 权威世界状态：房间、玩家、物体标签、谜题、物化、混乱值
// 客户端只上报意图与模拟结果，规则判定全部在此完成。
import {
  ROOM, SPAWNS, EXIT, PLATE1, OBJECTS, TAG_RULES, ABILITIES, CHAOS_EVENTS,
} from '../client/js/level.js';

const now = () => Date.now();
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, x, z) => Math.hypot(a[0] - x, a[2] - z);
const clone = (v) => JSON.parse(JSON.stringify(v));

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.send = opts.send || (() => {});
    this.players = [];   // {id,name,color,x,y,z,yaw,form,formUntil,hold,tagCd,morphCd,dc}
    this.hostId = null;
    this.phase = 'lobby';
    this.objects = [];
    this.puzzle = { chairGiven: false, corePowered: false, exitOpen: false, sideDoorOpen: false };
    this.chaos = 0;
    this.chaosMode = false;
    this.stats = null;
    this.startedAt = 0;
    this.colorIdx = 0;
  }

  /* ---------------- 玩家管理 ---------------- */

  find(id) { return this.players.find((p) => p.id === id); }

  addPlayer(id, name) {
    if (this.phase !== 'lobby') return { error: '对局进行中，请稍后加入' };
    if (this.players.length >= 4) return { error: '房间已满（Prototype 最多 4 人）' };
    const colors = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b'];
    const player = {
      id,
      name: String(name || '玩家').slice(0, 16),
      color: colors[this.players.length % colors.length],
      x: 0, y: 1, z: 0, yaw: 0,
      form: 'human', formUntil: 0,
      hold: null, tagCd: 0, morphCd: 0, dc: false,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = id;
    return { player };
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    if (this.hostId === id) this.hostId = this.players[0]?.id || null;
    if (this.phase === 'lobby') { this.lobby(); return; }
    if (this.players.filter((p) => !p.dc).length === 0) this.toLobby('全员离开，对局结束');
  }

  markDisconnected(id) {
    const p = this.find(id);
    if (!p) return;
    p.dc = true;
    if (this.phase === 'lobby') { this.removePlayer(id); return; }
    this.lobby();
  }

  toLobby(reason) {
    this.phase = 'lobby';
    this.puzzle = { chairGiven: false, corePowered: false, exitOpen: false, sideDoorOpen: false };
    for (const p of this.players) { p.form = 'human'; p.hold = null; p.tagCd = 0; p.morphCd = 0; }
    if (reason) this.feed(reason);
    this.lobby();
  }

  /* ---------------- 消息 ---------------- */

  sendTo(id, type, data) { this.send(id, { t: type, ...data }); }

  broadcast(type, data) { for (const p of this.players) this.sendTo(p.id, type, data); }

  ev(kind, data = {}) { this.broadcast('ev', { kind, ...data }); }

  feed(text) { this.ev('feed', { text }); }

  lobby() {
    this.broadcast('lobby', {
      hostId: this.hostId,
      phase: this.phase,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, dc: p.dc, form: p.form })),
    });
  }

  /* ---------------- 开局 ---------------- */

  startMatch(id) {
    if (id !== this.hostId) return '只有房主可以开始';
    if (this.phase !== 'lobby') return '对局已经开始';
    const live = this.players.filter((p) => !p.dc);
    if (live.length < 2) return '至少需要 2 名玩家';

    this.phase = 'playing';
    this.objects = clone(OBJECTS).map((o) => ({
      ...o, p: [...o.p], q: [0, 0, 0, 1], by: null,
    }));
    this.puzzle = { chairGiven: false, corePowered: false, exitOpen: false, sideDoorOpen: false };
    this.chaos = 0;
    this.chaosMode = false;
    this.startedAt = now();
    this.stats = { tags: 0, morphs: 0, throws: 0, chaosPeak: 0, solves: 0 };

    this.players.forEach((p, i) => {
      const s = SPAWNS[i % SPAWNS.length];
      [p.x, p.y, p.z] = s;
      p.yaw = Math.PI; // 面向北侧主厅
      p.form = 'human'; p.formUntil = 0; p.hold = null; p.tagCd = 0; p.morphCd = 0;
      p.dc = false;
    });

    for (const p of this.players) {
      this.sendTo(p.id, 'roundStart', {
        objects: this.objects,
        you: { id: p.id, spawn: [p.x, p.y, p.z] },
        puzzle: clone(this.puzzle),
        chaos: this.chaos,
      });
    }
    this.feed('实验开始：目标 —— 启动实验室出口');
    this.lobby();
    return null;
  }

  /* ---------------- 位置与出口 ---------------- */

  handlePose(id, m) {
    const p = this.find(id);
    if (!p || this.phase !== 'playing') return;
    const x = Number(m.x), y = Number(m.y), z = Number(m.z), yaw = Number(m.yaw);
    if (![x, y, z, yaw].every(Number.isFinite)) return;
    // 防瞬移：与上次位置距离过大则丢弃
    if (Math.hypot(x - p.x, y - p.y, z - p.z) > 8) return;
    p.x = x; p.y = y; p.z = z; p.yaw = yaw;

    if (this.puzzle.exitOpen && this.phase === 'playing'
      && x > EXIT.x0 && x < EXIT.x1 && z > EXIT.z0 && z < EXIT.z1) {
      this.win(p);
    }
  }

  /* ---------------- 物体位姿同步 ---------------- */

  handleObjPose(id, items) {
    if (this.phase !== 'playing' || !Array.isArray(items)) return;
    for (const it of items.slice(0, 32)) {
      const obj = this.objects.find((o) => o.id === it.id);
      if (!obj || obj.removed) continue;
      if (!Array.isArray(it.p) || !Array.isArray(it.q)) continue;
      if (it.p.some((v) => !Number.isFinite(v)) || it.q.some((v) => !Number.isFinite(v))) continue;
      // 模拟权仲裁：被抓取时仅持有者可上报，其余归 sim 指定者
      if (obj.by && obj.by !== id) continue;
      if (!obj.by && obj.sim && obj.sim !== id) continue;
      obj.p = it.p.map((v) => Math.max(-30, Math.min(30, v)));
      obj.q = it.q;
    }
  }

  /* ---------------- 抓取 / 投掷 ---------------- */

  _nearObj(p, objId, range) {
    const obj = this.objects.find((o) => o.id === objId && !o.removed);
    if (!obj) return null;
    if (dist3([p.x, p.y, p.z], obj.p) > range) return null;
    return obj;
  }

  handleGrab(id, objId) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';
    if (p.hold) return '手上已有物体';
    if (p.form !== 'human') return '物化状态下无法抓取';
    const obj = this._nearObj(p, objId, ABILITIES.grabRange);
    if (!obj) return '距离太远';
    if (obj.tags.includes('STATIC')) return '该物体被固定，先用标签枪改为 MOVABLE';
    p.hold = obj.id;
    obj.by = id;
    this.ev('hold', { id, obj: obj.id });
    return null;
  }

  handleRelease(id) {
    const p = this.find(id);
    if (!p || !p.hold) return null;
    const obj = this.objects.find((o) => o.id === p.hold);
    p.hold = null;
    if (obj) obj.by = null;
    this.ev('hold', { id, obj: null });
    return null;
  }

  handleThrow(id, v) {
    const p = this.find(id);
    if (!p || !p.hold) return '手上没有物体';
    const speed = Math.hypot(v?.[0] || 0, v?.[1] || 0, v?.[2] || 0);
    if (speed > 20) return '力度异常';
    const objId = p.hold;
    const obj = this.objects.find((o) => o.id === objId);
    p.hold = null;
    if (obj) {
      obj.by = null;
      if (speed > 12) this.addChaos(CHAOS_EVENTS.hardThrow, '高速投掷！');
    }
    this.ev('hold', { id, obj: null });
    this.ev('throw', { obj: objId, v, by: id });
    return null;
  }

  /* ---------------- 标签枪 ---------------- */

  handleTag(id, m) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';
    if (p.tagCd > now()) return `标签枪冷却中 ${Math.ceil((p.tagCd - now()) / 1000)}s`;
    const obj = this.objects.find((o) => o.id === m.objId && !o.removed);
    if (!obj) return '目标不存在';
    if (dist3([p.x, p.y, p.z], obj.p) > ABILITIES.tagGun.range) return '距离太远';
    if (obj.by && obj.by !== id) return '该物体正被别人持有';

    let changed = false;
    let absurd = false;
    if (typeof m.form === 'string') {
      const form = m.form.toUpperCase();
      if (!TAG_RULES.forms.includes(form)) return '未知标签';
      if (obj.form === form) return '标签未变化';
      absurd = obj.key === true; // 荒诞转换：把能源球等关键物改成家具
      obj.form = form;
      changed = true;
    } else if (typeof m.pair === 'string') {
      // m.pair 是客户端点选的属性（HEAVY/LIGHT/MOVABLE/STATIC 任意一端均可）
      const from = (obj.tags.includes('HEAVY') && m.pair === 'HEAVY')
        || (obj.tags.includes('LIGHT') && m.pair === 'LIGHT')
        ? (obj.tags.includes('HEAVY') ? 'HEAVY' : 'LIGHT')
        : (obj.tags.includes('MOVABLE') && m.pair === 'MOVABLE')
          || (obj.tags.includes('STATIC') && m.pair === 'STATIC')
          ? (obj.tags.includes('MOVABLE') ? 'MOVABLE' : 'STATIC')
          : null;
      if (!from) return '目标没有该属性';
      const target = TAG_RULES.pairs[from];
      if (!target) return '属性不可翻转';
      obj.tags = obj.tags.filter((t) => t !== 'HEAVY' && t !== 'LIGHT' && t !== 'MOVABLE' && t !== 'STATIC');
      obj.tags.push(target);
      changed = true;
    } else {
      return '缺少标签参数';
    }

    if (!changed) return null;
    p.tagCd = now() + ABILITIES.tagGun.cooldownMs;
    this.stats.tags += 1;
    if (absurd) this.addChaos(CHAOS_EVENTS.absurdTag, '荒诞转换！');
    this.ev('tag', { id, obj: obj.id, form: obj.form, tags: obj.tags });
    return null;
  }

  /* ---------------- 玩家物化 ---------------- */

  handleMorph(id) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';
    if (p.form !== 'human') return '已经物化';
    if (p.morphCd > now()) return `物化冷却中 ${Math.ceil((p.morphCd - now()) / 1000)}s`;
    if (p.hold) this.handleRelease(id);
    p.form = 'box';
    p.formUntil = now() + ABILITIES.morph.durationMs;
    p.morphCd = p.formUntil + ABILITIES.morph.cooldownMs; // 结束后再次可变
    this.stats.morphs += 1;
    this.addChaos(CHAOS_EVENTS.morphSelf, null);
    this.ev('morph', { id, form: 'box', until: p.formUntil });
    return null;
  }

  handleUnmorph(id) {
    const p = this.find(id);
    if (!p || p.form === 'human') return null;
    this._restore(p);
    return null;
  }

  _restore(p) {
    p.form = 'human';
    p.formUntil = 0;
    this.ev('morph', { id: p.id, form: 'human', until: 0 });
  }

  /* ---------------- 交互（NPC / 核心） ---------------- */

  handleInteract(id, target) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';

    if (target === 'npc') {
      if (this.puzzle.chairGiven) return '实验员已经有椅子了';
      const npc = [7.2, 0, 0];
      if (dist2([p.x, 0, p.z], npc[0], npc[2]) > 3) return '离实验员太远';
      const obj = p.hold && this.objects.find((o) => o.id === p.hold && !o.removed);
      if (!obj || obj.form !== 'CHAIR') return '实验员：「我需要一把椅子！」（拿标签枪把箱子改成 CHAIR，或去侧室找现成的）';
      obj.removed = true;
      p.hold = null;
      this.puzzle.chairGiven = true;
      this.stats.solves += 1;
      this.ev('hold', { id, obj: null });
      this.ev('consumed', { obj: obj.id });
      this.feed('实验员坐下：「很好！虽然我不知道你是怎么做到的。」');
      this._checkExitOpen();
      return null;
    }

    if (target === 'core') {
      if (this.puzzle.corePowered) return '核心已经启动';
      if (dist2([p.x, 0, p.z], CORE_X, CORE_Z) > 3.2) return '离核心太远';
      const obj = p.hold && this.objects.find((o) => o.id === p.hold && !o.removed);
      if (!obj || !obj.key) return '核心需要能源球';
      obj.removed = true;
      p.hold = null;
      this.puzzle.corePowered = true;
      this.stats.solves += 1;
      this.ev('hold', { id, obj: null });
      this.ev('consumed', { obj: obj.id });
      this.feed('核心启动！能源线路亮起');
      this._checkExitOpen();
      return null;
    }

    return `未知交互目标：${target}`;
  }

  _checkExitOpen() {
    const open = this.puzzle.chairGiven && this.puzzle.corePowered;
    if (open && !this.puzzle.exitOpen) {
      this.puzzle.exitOpen = true;
      this.feed('出口已开启！逃出去！');
    }
    this.ev('puzzle', { puzzle: clone(this.puzzle) });
  }

  /* ---------------- 混乱值 ---------------- */

  addChaos(delta, feedText) {
    if (this.phase !== 'playing') return;
    this.chaos = Math.max(0, Math.min(100, this.chaos + delta));
    this.stats.chaosPeak = Math.max(this.stats.chaosPeak, this.chaos);
    if (feedText) this.feed(feedText);
    if (this.chaos >= 90 && !this.chaosMode) {
      this.chaosMode = true;
      this.ev('chaosMode', { on: true });
      this.feed('CHAOS MODE！实验室失控了！');
      setTimeout(() => {
        if (this.phase !== 'playing') return;
        this.chaosMode = false;
        this.chaos = Math.min(this.chaos, 50);
        this.ev('chaosMode', { on: false, chaos: this.chaos });
        this.feed('实验室勉强恢复了正常');
      }, 6000);
    } else {
      this.ev('chaos', { chaos: this.chaos });
    }
  }

  /* ---------------- 每帧检查（10Hz） ---------------- */

  tick() {
    if (this.phase !== 'playing') return;
    const t = now();

    // 物化到期
    for (const p of this.players) {
      if (p.form !== 'human' && p.formUntil && t >= p.formUntil) this._restore(p);
    }

    // 物理模拟权：被持有时归持有者，否则归最近的在线玩家（客户端只模拟 sim===自己的物体）
    for (const obj of this.objects) {
      if (obj.removed) continue;
      if (obj.by && this.find(obj.by)) { obj.sim = obj.by; continue; }
      let best = null, bestD = 1e9;
      for (const p of this.players) {
        if (p.dc) continue;
        const d = dist3([p.x, p.y, p.z], obj.p);
        if (d < bestD) { bestD = d; best = p; }
      }
      obj.sim = bestD < 16 ? best.id : null;
    }

    // 压力板：有玩家（含物化形态）站在板上 → 侧室门开
    const held = this.players.some((p) => !p.dc
      && p.x > PLATE1.x0 && p.x < PLATE1.x1 && p.z > PLATE1.z0 && p.z < PLATE1.z1 && p.y < 1.2);
    if (held !== this.puzzle.sideDoorOpen) {
      this.puzzle.sideDoorOpen = held;
      this.ev('puzzle', { puzzle: clone(this.puzzle) });
      this.feed(held ? '压力板被压住，侧室门打开了' : '压力板释放，侧室门关闭');
    }
  }

  /* ---------------- 快照 ---------------- */

  snap() {
    if (this.phase !== 'playing') return;
    const t = now();
    this.broadcast('snap', {
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color,
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3),
        form: p.form, hold: p.hold, dc: p.dc,
      })),
      objs: this.objects.filter((o) => !o.removed).map((o) => ({
        id: o.id, p: o.p.map((v) => +v.toFixed(3)), q: o.q.map((v) => +v.toFixed(4)), sim: o.sim || null,
      })),
      chaos: this.chaos,
      cooldowns: Object.fromEntries(this.players.map((p) => [
        p.id,
        { tag: Math.max(0, p.tagCd - t), morph: Math.max(0, p.morphCd - t) },
      ])),
    });
  }

  /* ---------------- 结算 ---------------- */

  win(p) {
    this.phase = 'done';
    const timeMs = now() - this.startedAt;
    const mm = String(Math.floor(timeMs / 60000)).padStart(2, '0');
    const ss = String(Math.floor((timeMs % 60000) / 1000)).padStart(2, '0');
    let title = '实验室模范生';
    if (this.stats.tags >= 4) title = '标签枪狂魔';
    else if (this.stats.morphs >= 2) title = '物体体验家';
    else if (this.stats.chaosPeak >= 60) title = '头号破坏王';
    this.feed(`${p.name} 按下了出口开关！`);
    this.broadcast('roundEnd', {
      by: { id: p.id, name: p.name },
      time: `${mm}:${ss}`,
      stats: { ...this.stats, chaosPeak: this.chaos },
      title,
      puzzle: clone(this.puzzle),
      backInMs: 12_000,
    });
    // 展示结算后自动回大厅
    setTimeout(() => {
      if (this.phase === 'done') this.toLobby();
    }, 12_000);
  }

  /* ---------------- 聊天 ---------------- */

  chat(id, text) {
    const p = this.find(id);
    if (!p) return '你不在房间里';
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean) return '消息为空';
    this.broadcast('chat', { from: p.name, fromId: p.id, color: p.color, text: clean });
    return null;
  }
}

const CORE_X = -6.5;
const CORE_Z = -5.5;

export function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
