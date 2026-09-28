// 权威世界状态：房间、玩家、物体标签、谜题、物化、混乱值
// 客户端只上报意图与模拟结果，规则判定全部在此完成。
import {
  ROOM, SPAWNS, EXIT, PLATE1, OBJECTS, TAG_RULES, ABILITIES, CHAOS_EVENTS,
  RANDOM_EVENTS, SCALE_LEVELS, NPC, NPC_HOME, NPC_LINES, BUTTONS, BUTTON_HOLD_MS,
} from '../client/js/level.js';

const now = () => Date.now();
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, x, z) => Math.hypot(a[0] - x, a[2] - z);
const clone = (v) => JSON.parse(JSON.stringify(v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.send = opts.send || (() => {});
    this.players = [];   // {id,name,color,x,y,z,yaw,form,formUntil,hold,tagCd,scaleCd,copyCd,morphCd,dc}
    this.hostId = null;
    this.phase = 'lobby';
    this.objects = [];
    this.puzzle = freshPuzzle();
    this._btnHold = [0, 0, 0];
    this.chaos = 0;
    this.chaosMode = false;
    this.stats = null;
    this.startedAt = 0;
    this.colorIdx = 0;
    // 随机事件与世界状态
    this.eventMs = opts.eventMs ?? 40_000; // 0 = 禁用随机事件（测试可关）
    this.eventTimer = null;
    this.eventQueue = [];
    this.giant = null;      // {id, until}
    this.lowGrav = null;    // {until}
    this.copySeq = 0;
    this._lastSlip = 0;
    this.npc = {
      x: NPC_HOME.x, z: NPC_HOME.z, yaw: Math.PI / 2,
      line: '我需要一把椅子！', lineUntil: 0, nextLineAt: 0, scared: false,
    };
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
      hold: null, tagCd: 0, scaleCd: 0, copyCd: 0, morphCd: 0, dc: false,
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
    console.log(`[toLobby] room=${this.code}${reason ? ` (${reason})` : ''}`);
    this.puzzle = freshPuzzle();
    this._btnHold = [0, 0, 0];
    for (const p of this.players) {
      p.form = 'human'; p.hold = null; p.tagCd = 0; p.scaleCd = 0; p.copyCd = 0; p.morphCd = 0;
    }
    this._clearWorldTimers();
    if (reason) this.feed(reason);
    this.lobby();
  }

  _clearWorldTimers() {
    if (this.eventTimer) { clearTimeout(this.eventTimer); this.eventTimer = null; }
    if (this.giant) { this.giant = null; }
    if (this.lowGrav) { this.lowGrav = null; }
  }

  // 房间回收：清掉全部定时器，防止残留回调作用于已删除房间
  destroy() {
    this._clearWorldTimers();
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
    if (live.length < 1) return '房间内没有可开始的玩家';

    this.phase = 'playing';
    this._clearWorldTimers();
    this.objects = clone(OBJECTS).map((o) => ({
      ...o, scale: 1, p: [...o.p], q: [0, 0, 0, 1], by: null,
    }));
    this.puzzle = freshPuzzle();
    this._btnHold = [0, 0, 0];
    this.chaos = 0;
    this.chaosMode = false;
    this.startedAt = now();
    this.stats = { tags: 0, morphs: 0, throws: 0, chaosPeak: 0, solves: 0, copies: 0, scaled: 0, events: 0, slips: 0, blasts: 0 };

    // NPC 重置：开局亮出第一句提示
    this.npc = {
      x: NPC_HOME.x, z: NPC_HOME.z, yaw: Math.PI / 2,
      line: '我需要一把椅子！', lineUntil: now() + 5000,
      nextLineAt: now() + 12_000, scared: false,
    };

    this.players.forEach((p, i) => {
      const s = SPAWNS[i % SPAWNS.length];
      [p.x, p.y, p.z] = s;
      p.yaw = Math.PI; // 面向北侧主厅
      p.form = 'human'; p.formUntil = 0; p.hold = null;
      p.tagCd = 0; p.scaleCd = 0; p.copyCd = 0; p.morphCd = 0;
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
    this._scheduleEvent();
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
    if (!obj) return '抓取失败：距离太远';
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

  /* ---------------- 缩放枪（设计书 §14.2） ---------------- */

  handleScale(id, m) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';
    if (p.scaleCd > now()) return `缩放枪冷却中 ${Math.ceil((p.scaleCd - now()) / 1000)}s`;
    const obj = this.objects.find((o) => o.id === m.objId && !o.removed);
    if (!obj) return '目标不存在';
    if (dist3([p.x, p.y, p.z], obj.p) > ABILITIES.scaleGun.range) return '距离太远';
    if (obj.by && obj.by !== id) return '该物体正被别人持有';
    const dir = m.dir === -1 ? -1 : 1;
    const cur = SCALE_LEVELS.indexOf(obj.scale ?? 1);
    const next = Math.max(0, Math.min(SCALE_LEVELS.length - 1, (cur < 0 ? 1 : cur) + dir));
    if (next === (cur < 0 ? 1 : cur)) return dir > 0 ? '已经最大了' : '已经最小了';
    obj.scale = SCALE_LEVELS[next];
    p.scaleCd = now() + ABILITIES.scaleGun.cooldownMs;
    this.stats.scaled += 1;
    this.ev('scale', { id, obj: obj.id, scale: obj.scale });
    return null;
  }

  /* ---------------- 复制枪（设计书 §14.3） ---------------- */

  handleCopy(id, m) {
    if (this.phase !== 'playing') return '对局未进行';
    const p = this.find(id);
    if (!p || p.dc) return '不可用';
    if (p.copyCd > now()) return `复制枪冷却中 ${Math.ceil((p.copyCd - now()) / 1000)}s`;
    const obj = this.objects.find((o) => o.id === m.objId && !o.removed);
    if (!obj) return '目标不存在';
    if (obj.key) return '关键物体不可复制';
    if (obj.kind) return '这种物体不可复制';
    if (this.objects.filter((o) => !o.removed).length >= ABILITIES.maxObjects) return '场上物体太多';
    if (dist3([p.x, p.y, p.z], obj.p) > ABILITIES.copyGun.range) return '距离太远';

    const ang = Math.random() * Math.PI * 2;
    const copy = {
      id: `${obj.id}_c${++this.copySeq}`,
      form: obj.form,
      tags: [...obj.tags],
      size: [...obj.size],
      scale: obj.scale ?? 1,
      p: [
        Math.max(-9.4, Math.min(9.4, obj.p[0] + Math.cos(ang) * 1.0)),
        obj.p[1] + 0.1,
        Math.max(-7.4, Math.min(7.4, obj.p[2] + Math.sin(ang) * 1.0)),
      ],
      q: [0, 0, 0, 1],
      by: null,
      from: id,
      life: now() + ABILITIES.copyGun.lifetimeMs, // 限时存在
    };
    this.objects.push(copy);
    p.copyCd = now() + ABILITIES.copyGun.cooldownMs;
    this.stats.copies += 1;
    this.ev('spawn', { obj: copy });
    return null;
  }

  /* ---------------- 客户端上报的混乱事件（香蕉皮等） ---------------- */

  handleChaosEvent(id, type) {
    if (this.phase !== 'playing') return '对局未进行';
    if (!this.find(id)) return '不可用';
    if (type === 'banana') {
      const t = now();
      if (t - this._lastSlip < 1500) return null; // 全局限速防刷
      this._lastSlip = t;
      this.stats.slips += 1;
      this.addChaos(CHAOS_EVENTS.bananaSlip, '有人踩了香蕉皮，滑飞了！');
    }
    return null;
  }

  /* ---------------- 随机事件调度（设计书 §25） ---------------- */

  _scheduleEvent() {
    if (this.eventMs <= 0) return; // 测试模式禁用
    const first = this.eventTimer === null && this.stats && this.stats.events === 0;
    const delay = first ? this.eventMs : 45_000 + Math.random() * 35_000;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = null;
      if (this.phase !== 'playing') return;
      // 事件调度绝不能把进程打崩
      try { this._fireEvent(); } catch (e) { console.error('[event]', this.code, e); }
      this._scheduleEvent();
    }, delay);
  }

  _fireEvent() {
    const alive = this.players.filter((p) => !p.dc);
    if (!alive.length) return; // 全员断线：跳过本轮事件
    if (!this.eventQueue.length) this.eventQueue = shuffle(Object.keys(RANDOM_EVENTS));
    const type = this.eventQueue.pop();
    const cfg = RANDOM_EVENTS[type];
    this.stats.events += 1;
    this.ev('event', { type });
    this.feed(cfg.text);
    if (cfg.chaos) this.addChaos(cfg.chaos, null);
    if (type === 'chicken') {
      // 实验员对鸡的定向反应（设计书 §26）
      this.npc.line = '鸡又来了？！这不是实验步骤！';
      this.npc.lineUntil = now() + 4000;
    }

    if (type === 'chicken') {
      const spawn = pick(SPAWNS);
      for (let i = 0; i < cfg.count; i++) {
        const obj = {
          id: `chicken_${this.stats.events}_${i}`,
          kind: 'chicken',
          form: 'BOX',
          tags: ['LIGHT', 'MOVABLE', 'PHYSICAL'],
          size: [0.4, 0.45, 0.55],
          scale: 1,
          p: [spawn[0] + (Math.random() - 0.5) * 4, 0.6, spawn[2] + (Math.random() - 0.5) * 4],
          q: [0, 0, 0, 1],
          by: null,
          life: now() + cfg.lifetimeMs,
        };
        this.objects.push(obj);
        this.ev('spawn', { obj });
      }
    } else if (type === 'giant') {
      const target = pick(alive);
      this.giant = { id: target.id, until: now() + cfg.durationMs };
      this.ev('eventEnd', { type: 'giant', target: target.id, until: this.giant.until });
    } else if (type === 'lowGravity') {
      this.lowGrav = { until: now() + cfg.durationMs };
      this.ev('eventEnd', { type: 'lowGravity', until: this.lowGrav.until });
    } else if (type === 'banana') {
      const p0 = pick(alive);
      for (let i = 0; i < cfg.count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 4;
        this.objects.push({
          id: `banana_${this.stats.events}_${i}`,
          kind: 'banana',
          form: 'BOX',
          tags: ['STATIC', 'PHYSICAL'],
          size: [0.55, 0.06, 0.55],
          scale: 1,
          p: [
            Math.max(-9.4, Math.min(9.4, p0.x + Math.cos(ang) * r)),
            0.04,
            Math.max(-7.4, Math.min(7.4, p0.z + Math.sin(ang) * r)),
          ],
          q: [0, 0, 0, 1],
          by: null,
          life: now() + cfg.lifetimeMs,
        });
        this.ev('spawn', { obj: this.objects[this.objects.length - 1] });
      }
    }
    // rampage：纯 ev，客户端 sim 者给自己模拟的物体加冲量
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
    const open = (this.puzzle.chairGiven && this.puzzle.corePowered) || this.puzzle.buttonOpen;
    if (open && !this.puzzle.exitOpen) {
      this.puzzle.exitOpen = true;
      this.feed(this.puzzle.buttonOpen && !(this.puzzle.chairGiven && this.puzzle.corePowered)
        ? '💥 三按钮全按下！暴力解锁出口！'
        : '出口已开启！逃出去！');
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
      this.stats.blasts += 1;
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

    // 全员断线：立即收局回大厅，防止僵尸对局空转（事件/计时器会一直跑）
    if (!this.players.some((p) => !p.dc)) {
      this.toLobby('全员断线');
      return;
    }

    // 物化到期
    for (const p of this.players) {
      if (p.form !== 'human' && p.formUntil && t >= p.formUntil) this._restore(p);
    }

    // 限时物体（复制体 / 鸡 / 香蕉）到期
    for (const obj of this.objects) {
      if (!obj.removed && obj.life && t >= obj.life) {
        obj.removed = true;
        this.ev('despawn', { obj: obj.id });
      }
    }

    // 巨型玩家 / 低重力到期
    if (this.giant && t >= this.giant.until) {
      this.ev('eventEnd', { type: 'giant', target: this.giant.id, until: 0 });
      this.giant = null;
    }
    if (this.lowGrav && t >= this.lowGrav.until) {
      this.ev('eventEnd', { type: 'lowGravity', until: 0 });
      this.lowGrav = null;
    }

    this._npcTick(t);

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

    // 三按钮谜题（设计书 §24）：玩家或物体占用 ≥1 秒算按下，三个同时按住 → 暴力直通
    const btnStates = BUTTONS.map((btn, i) => {
      const occupied =
        this.players.some((p) => !p.dc
          && Math.hypot(p.x - btn.p[0], p.z - btn.p[2]) < 0.85
          && Math.abs((p.y + 0.9) - btn.p[1]) < 1.15)
        || this.objects.some((o) => !o.removed && o.kind !== 'banana'
          && Math.hypot(o.p[0] - btn.p[0], o.p[2] - btn.p[2]) < 0.95
          && Math.abs(o.p[1] - btn.p[1]) < 1.0);
      if (!occupied) this._btnHold[i] = 0;
      else if (!this._btnHold[i]) this._btnHold[i] = t;
      return !!this._btnHold[i] && t - this._btnHold[i] >= BUTTON_HOLD_MS;
    });
    const btnChanged = btnStates.some((s, i) => s !== this.puzzle.buttons[i]);
    if (btnChanged) this.puzzle.buttons = btnStates;
    const allPressed = btnStates.every(Boolean);
    if (allPressed && !this.puzzle.buttonOpen) {
      this.puzzle.buttonOpen = true;
      this.stats.solves += 1;
      this._checkExitOpen();
      return; // _checkExitOpen 已广播 puzzle
    }
    if (btnChanged) this.ev('puzzle', { puzzle: clone(this.puzzle) });

    if (held !== this.puzzle.sideDoorOpen) {
      this.puzzle.sideDoorOpen = held;
      this.ev('puzzle', { puzzle: clone(this.puzzle) });
      this.feed(held ? '压力板被压住，侧室门打开了' : '压力板释放，侧室门关闭');
    }
  }

  /* ---------------- NPC AI（设计书 §26：看玩家、会躲、会说话） ---------------- */

  _npcTick(t) {
    const npc = this.npc;

    // 最近的在线玩家（用于面向）
    let near = null, nearD = 1e9;
    for (const p of this.players) {
      if (p.dc) continue;
      const d = Math.hypot(p.x - npc.x, p.z - npc.z);
      if (d < nearD) { nearD = d; near = p; }
    }

    // 躲鸡：1.8m 内的鸡会把实验员吓跑（坐下后不再移动）
    let threat = null;
    if (!this.puzzle.chairGiven) {
      for (const o of this.objects) {
        if (o.removed || o.kind !== 'chicken') continue;
        const d = Math.hypot(o.p[0] - npc.x, o.p[2] - npc.z);
        if (d < 1.8) { threat = o; break; }
      }
    }
    if (threat) {
      const dx = npc.x - threat.p[0];
      const dz = npc.z - threat.p[2];
      const len = Math.hypot(dx, dz) || 1;
      npc.x = Math.max(4.0, Math.min(8.6, npc.x + (dx / len) * 0.3));
      npc.z = Math.max(-6.0, Math.min(6.0, npc.z + (dz / len) * 0.3));
      npc.scared = true;
      if (t - (npc._scaredLineAt || 0) > 6000) {
        npc._scaredLineAt = t;
        npc.line = '鸡又来了？！离我远点！';
        npc.lineUntil = t + 3000;
      }
    } else {
      npc.scared = false;
    }

    // 面向：躲鸡时面向逃跑方向，否则面向最近玩家
    const tx = threat ? npc.x + (npc.x - threat.p[0]) : (near ? near.x : npc.x);
    const tz = threat ? npc.z + (npc.z - threat.p[2]) : (near ? near.z : npc.z);
    let targetYaw = Math.atan2(tx - npc.x, tz - npc.z);
    let dy = targetYaw - npc.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    npc.yaw += dy * 0.18;

    // 随机说话（状态感知：交椅后换池）
    if (t >= npc.nextLineAt) {
      npc.nextLineAt = t + 9000 + Math.random() * 9000;
      const pool = this.puzzle.chairGiven ? NPC_LINES.done
        : near && nearD < 6 ? NPC_LINES.waiting : NPC_LINES.idle;
      npc.line = pick(pool);
      npc.lineUntil = t + 4000;
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
        giant: !!(this.giant && this.giant.id === p.id && t < this.giant.until),
      })),
      objs: this.objects.filter((o) => !o.removed).map((o) => ({
        id: o.id, p: o.p.map((v) => +v.toFixed(3)), q: o.q.map((v) => +v.toFixed(4)), sim: o.sim || null,
      })),
      chaos: this.chaos,
      lowGrav: !!(this.lowGrav && t < this.lowGrav.until),
      npc: {
        x: +this.npc.x.toFixed(3),
        z: +this.npc.z.toFixed(3),
        yaw: +this.npc.yaw.toFixed(3),
        scared: this.npc.scared,
        line: t < this.npc.lineUntil ? this.npc.line : null,
      },
      cooldowns: Object.fromEntries(this.players.map((p) => [
        p.id,
        {
          tag: Math.max(0, p.tagCd - t),
          scale: Math.max(0, p.scaleCd - t),
          copy: Math.max(0, p.copyCd - t),
          morph: Math.max(0, p.morphCd - t),
        },
      ])),
    });
  }

  /* ---------------- 结算 ---------------- */

  win(p) {
    this.phase = 'done';
    this._clearWorldTimers();
    console.log(`[roundEnd] room=${this.code} by=${p.name} (${Math.round((now() - this.startedAt) / 1000)}s)`);
    const timeMs = now() - this.startedAt;
    const mm = String(Math.floor(timeMs / 60000)).padStart(2, '0');
    const ss = String(Math.floor((timeMs % 60000) / 1000)).padStart(2, '0');
    let title = '实验室模范生';
    if (this.stats.tags >= 4) title = '标签枪狂魔';
    else if (this.stats.morphs >= 2) title = '物体体验家';
    else if (this.stats.copies >= 3) title = '无限复制批发商';
    else if (this.stats.slips >= 2) title = '香蕉皮之友';
    else if (this.stats.events >= 3) title = '随机事件磁铁';
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
const freshPuzzle = () => ({
  chairGiven: false, corePowered: false, exitOpen: false, sideDoorOpen: false,
  buttonOpen: false, buttons: [false, false, false],
});

export function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
