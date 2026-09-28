// 交互系统：射线目标、抓取/投掷、标签枪、智能 E 键
import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { NPC, CORE_POS, ABILITIES, TAG_RULES } from './level.js';
import { sfx } from './audio.js';

const FORM_LABEL = { BOX: '箱子', CHAIR: '椅子', SPRING: '弹簧', LAMP: '灯', ORB: '能源球' };
const FORM_KEYS = ['BOX', 'CHAIR', 'SPRING', 'LAMP'];

export class Interact {
  constructor(game, player, ui, net) {
    this.game = game;
    this.player = player;
    this.ui = ui;
    this.net = net;
    this.held = null;        // objId（本地持有的动态物体）
    this.target = null;      // 当前射线命中的动态物体 id
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 7;

    addEventListener('mousedown', (e) => {
      if (e.button === 0 && player.locked && player.enabled) this._attack();
    });
    addEventListener('keydown', (e) => {
      if (!player.enabled || player.chatOpen) return;
      if (e.repeat) return;
      if (e.code === 'KeyE') this.smartE();
      if (e.code === 'KeyR') this._flipPair('HEAVY');
      if (e.code === 'KeyT') this._flipPair('MOVABLE');
      if (e.code === 'KeyZ') this._scale(+1);
      if (e.code === 'KeyX') this._scale(-1);
      if (e.code === 'KeyG') this._copy();
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (idx >= 0) this._retag(FORM_KEYS[idx]);
    });
  }

  /* ---------------- 每帧：目标与提示 ---------------- */

  update() {
    const p = this.player;
    if (!p.enabled) { this.ui.prompt(null); this.ui.tagPanel(null); return; }

    // 射线找目标
    this.target = null;
    if (p.locked) {
      this.raycaster.set(p.camera.position, p.camDir());
      const meshes = [];
      for (const d of this.game.dynamics.values()) {
        if (!d.removed && d.id !== this.held) meshes.push(d.mesh);
      }
      const hits = this.raycaster.intersectObjects(meshes, true);
      if (hits.length) {
        const root = hits[0].object.parent;
        for (const [id, d] of this.game.dynamics) {
          if (d.mesh === root || d.mesh === hits[0].object) { this.target = id; break; }
        }
        if (!this.target) {
          for (const [id, d] of this.game.dynamics) {
            if (d.mesh === root.parent || d.mesh.children.includes(hits[0].object)) { this.target = id; break; }
          }
        }
      }
    }

    const d = this.target ? this.game.dynamics.get(this.target) : null;
    const bp = p.body.position;
    const nearNpc = Math.hypot(bp.x - NPC.pos[0], bp.z - NPC.pos[2]) < 3;
    const nearCore = Math.hypot(bp.x - CORE_POS[0], bp.z - CORE_POS[2]) < 3.2;

    // 提示
    let prompt = null;
    if (this.held) {
      const objName = this._name(this.game.dynamics.get(this.held));
      prompt = `拿着 <b>${objName}</b> · <b>E</b> 放下`;
      if (nearNpc && this.game.dynamics.get(this.held)?.form === 'CHAIR') prompt = `把 <b>椅子</b>交给实验员 <b>E</b>`;
      else if (nearCore && this.game.dynamics.get(this.held)?.def.key) prompt = `插入 <b>能源球</b> <b>E</b>`;
      else if (p.locked) prompt += ` · <b>左键</b> 投掷`;
    } else if (d) {
      const dist = bp.distanceTo(d.body.position);
      if (dist < ABILITIES.grabRange) prompt = `抓取 <b>${this._name(d)}</b> <b>E</b>`;
      else prompt = `<b>${this._name(d)}</b>（走近抓取 · <b>1-4</b> 改标签）`;
    } else if (nearNpc) {
      prompt = `<b>E</b> 和实验员说话（他需要一把 <b>椅子</b>）`;
    } else if (nearCore) {
      prompt = `<b>E</b> 检查核心（缺少能源球）`;
    } else if (this._platePrompt()) {
      prompt = this._platePrompt();
    }
    this.ui.prompt(prompt);

    // 标签枪面板（对准 6m 内可改标签的物体）
    if (d && p.locked) {
      const dist = bp.distanceTo(d.body.position);
      if (dist <= ABILITIES.tagGun.range) {
        this.ui.tagPanel(`
          <b>${this._name(d)}</b> 标签枪
          ${FORM_KEYS.map((f, i) => `<span class="tag ${d.form === f ? 'hot' : ''}">${i + 1} ${FORM_LABEL[f]}</span>`).join('')}
          <br>
          <span class="tag ${d.tags.includes('HEAVY') || d.tags.includes('LIGHT') ? 'hot' : ''}">${d.tags.includes('HEAVY') ? 'HEAVY 重' : 'LIGHT 轻'}</span>
          <span class="tag">R 翻转</span>
          <span class="tag ${d.tags.includes('STATIC') ? '' : 'hot'}">${d.tags.includes('STATIC') ? 'STATIC 固定' : 'MOVABLE 可动'}</span>
          <span class="tag">T 翻转</span>
          <br>
          <span class="tag">Z 放大</span><span class="tag">X 缩小</span><span class="tag">G 复制</span>
        `);
      } else {
        this.ui.tagPanel(null);
      }
    } else {
      this.ui.tagPanel(null);
    }

    // 抓取拉扯
    if (this.held) this._tug();
  }

  _platePrompt() {
    const p = this.player.body.position;
    if (Math.abs(p.x) < 1.6 && Math.abs(p.z - 6) < 1.6) {
      return `压力板：<b>站住</b>或<b>物化(F)</b>压住它，为队友打开侧室门`;
    }
    return null;
  }

  _name(d) {
    if (!d) return '物体';
    const base = FORM_LABEL[d.form] || d.form;
    return d.def.key ? `能源球（${base}形态）` : base;
  }

  /* ---------------- E 键：智能交互 ---------------- */

  smartE() {
    const p = this.player;
    const bp = p.body.position;
    const nearNpc = Math.hypot(bp.x - NPC.pos[0], bp.z - NPC.pos[2]) < 3;
    const nearCore = Math.hypot(bp.x - CORE_POS[0], bp.z - CORE_POS[2]) < 3.2;

    if (this.held) {
      const d = this.game.dynamics.get(this.held);
      if (nearCore && d?.def.key) { this.net.send({ t: 'interact', target: 'core' }); return; }
      if (nearNpc && d?.form === 'CHAIR') { this.net.send({ t: 'interact', target: 'npc' }); return; }
      this.release();
      return;
    }
    if (nearNpc) { this.net.send({ t: 'interact', target: 'npc' }); return; }
    if (nearCore) { this.net.send({ t: 'interact', target: 'core' }); return; }
    if (this.target) this.grab(this.target);
  }

  grab(id) {
    const d = this.game.dynamics.get(id);
    if (!d || d.removed) return;
    if (d.tags.includes('STATIC')) { this.ui.toast('物体被固定 —— 先按 T 改成 MOVABLE'); return; }
    this.net.send({ t: 'grab', id });
    // 乐观本地抓取（服务器确认前也先拿住，失败会收到 error 并回滚）
    this._setHold(id);
  }

  _setHold(id) {
    const d = this.game.dynamics.get(id);
    if (!d) return;
    this.held = id;
    d.heldBy = 'me';
    // 立即抢占模拟权（服务器 tick 确认 sim 后一致）
    d.sim = this.net.myId;
    d.body.type = CANNON.Body.DYNAMIC;
    d.body.mass = d.tags.includes('STATIC') ? 5 : (d.tags.includes('LIGHT') ? 3 : 12);
    d.body.updateMassProperties();
    d.body.allowSleep = false;
    d.body.angularVelocity.set(0, 0, 0);
    sfx.play('grab');
  }

  release() {
    if (!this.held) return;
    const d = this.game.dynamics.get(this.held);
    if (d) {
      d.heldBy = null;
      d.body.allowSleep = true;
      d.sim = null; // 等服务器重新分配最近模拟者
    }
    this.held = null;
    this.net.send({ t: 'release' });
  }

  remoteHold(playerId, objId) {
    if (objId) {
      const d = this.game.dynamics.get(objId);
      if (d) d.heldBy = playerId;
      // 物体被别人拿走时释放本地乐观持有
      if (playerId !== this.net.myId && this.held === objId) this.held = null;
    } else {
      // 释放：清掉该玩家持有的所有物体
      for (const d of this.game.dynamics.values()) {
        if (d.heldBy === playerId) d.heldBy = null;
      }
    }
  }

  _tug() {
    const d = this.game.dynamics.get(this.held);
    if (!d) { this.held = null; return; }
    const head = new CANNON.Vec3(
      this.player.body.position.x,
      this.player.body.position.y - this.player.footOffset + 1.35,
      this.player.body.position.z
    );
    const dir = this.player.camDir();
    const tx = head.x + dir.x * 1.7;
    const ty = head.y + dir.y * 1.7;
    const tz = head.z + dir.z * 1.7;
    const b = d.body;
    const k = 11;
    b.velocity.set(
      Math.max(-16, Math.min(16, (tx - b.position.x) * k)),
      Math.max(-16, Math.min(16, (ty - b.position.y) * k)),
      Math.max(-16, Math.min(16, (tz - b.position.z) * k))
    );
    b.angularVelocity.set(0, 0, 0);
    b.quaternion.slerp(new CANNON.Quaternion(0, 0, 0, 1), 0.15, b.quaternion);
  }

  /* ---------------- 投掷 ---------------- */

  _attack() {
    if (!this.held) return;
    const d = this.game.dynamics.get(this.held);
    if (!d) { this.held = null; return; }
    const dir = this.player.camDir();
    const speed = d.tags.includes('LIGHT') ? 16 : d.tags.includes('HEAVY') ? 9 : 12;
    d.body.velocity.set(
      dir.x * speed + this.player.body.velocity.x * 0.4,
      Math.max(2, dir.y * speed + 3),
      dir.z * speed + this.player.body.velocity.z * 0.4
    );
    d.body.angularVelocity.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    d.heldBy = null;
    d.body.allowSleep = true;
    this.held = null;
    sfx.play('throw');
    this.net.send({ t: 'throw', v: [dir.x * speed, dir.y * speed, dir.z * speed] });
  }

  /* ---------------- 标签枪 ---------------- */

  _retag(form) {
    if (!this.target) return;
    sfx.play('tag');
    this.net.send({ t: 'tag', objId: this.target, form });
  }

  _flipPair(pair) {
    if (!this.target) return;
    sfx.play('tag');
    this.net.send({ t: 'tag', objId: this.target, pair });
  }

  /* ---------------- 缩放枪 / 复制枪（设计书 §14.2/14.3） ---------------- */

  _scale(dir) {
    if (!this.target) return;
    sfx.play('scale');
    this.net.send({ t: 'scale', objId: this.target, dir });
  }

  _copy() {
    if (!this.target) return;
    sfx.play('copy');
    this.net.send({ t: 'copy', objId: this.target });
  }

  onTagApplied(objId, form, tags) {
    // 服务器确认：本地乐观状态与正式状态对齐（视觉重建在 game.applyTag）
    if (this.held === objId) {
      const d = this.game.dynamics.get(objId);
      if (d) { d.tags = [...tags]; d.form = form; }
    }
  }

  onServerError(msg) {
    // 抓取被服务器拒绝时回滚本地乐观持有（消息带"抓取失败"前缀才回滚，避免误伤其他能力）
    if (/抓取失败|手上已有物体|物化状态下/.test(msg)) {
      const d = this.held && this.game.dynamics.get(this.held);
      if (d) { d.heldBy = null; d.body.allowSleep = true; }
      this.held = null;
    }
    sfx.play('error');
    this.ui.toast(msg);
  }
}
