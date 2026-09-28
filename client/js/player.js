// 本地玩家：物理体、WASD 控制、第三人称相机、物化
import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { buildPlayerMesh } from './game.js';
import { ROOM } from './level.js';
import { sfx } from './audio.js';

const HUMAN_R = 0.42;
const BOX_HALF = 0.4;
const WALK = 5.2;
const BOX_WALK = 2.4;
const JUMP = 7.8;

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
    game.camera = this.camera;

    this.form = 'human';
    this.giant = false;      // 巨型玩家事件
    this.yaw = Math.PI;       // 相机水平角
    this.pitch = -0.25;
    this.keys = new Set();
    this.locked = false;
    this.enabled = false;     // 对局中才可操作
    this.onToggleMorph = null;

    this.body = this._makeBody(HUMAN_R, 70);
    this.visual = buildPlayerMesh('#ff6b6b', 'human');
    this.footOffset = HUMAN_R;
    game.scene.add(this.visual);

    this._ray = new CANNON.Ray(new CANNON.Vec3(), new CANNON.Vec3());
    this._rayResult = new CANNON.RaycastResult();

    this._bindInput();
  }

  _makeBody(r, mass) {
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Sphere(r),
      linearDamping: 0.12,
      angularDamping: 1,
      position: new CANNON.Vec3(...ROOM_SPAWN_DEFAULT),
    });
    body.fixedRotation = true;
    body.updateMassProperties();
    this.game.world.addBody(body);
    return body;
  }

  spawnAt(pos, color) {
    const foot = [pos[0], pos[1], pos[2]];
    this._setFormInstant('human');
    this.body.position.set(foot[0], foot[1] + this.footOffset, foot[2]);
    this.body.velocity.set(0, 0, 0);
    if (this.visual.material) this.visual.material.color.set(color);
    // 重建颜色（visual 是 group）
    this.game.scene.remove(this.visual);
    this.visual = buildPlayerMesh(color, this.form);
    if (this.giant) this.visual.scale.setScalar(2);
    this.game.scene.add(this.visual);
    this.yaw = Math.PI;
    this.pitch = -0.25;
  }

  setColor(color) {
    this.game.scene.remove(this.visual);
    this.visual = buildPlayerMesh(color, this.form);
    if (this.giant) this.visual.scale.setScalar(2);
    this.game.scene.add(this.visual);
  }

  /* ---------------- 输入 ---------------- */

  _bindInput() {
    const canvas = this.game.canvas;
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked && !this.chatOpen) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0026;
      this.pitch -= e.movementY * 0.0026;
      this.pitch = Math.max(-1.15, Math.min(0.7, this.pitch));
    });
    addEventListener('keydown', (e) => {
      if (document.activeElement === document.getElementById('chat-input')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.enabled && !e.repeat) this.onToggleMorph?.();
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  get chatOpen() {
    return !document.getElementById('chat-input').hidden;
  }

  /* ---------------- 每帧 ---------------- */

  update(dt) {
    const body = this.body;
    const grounded = this._grounded();

    // 移动方向（相对相机）
    const speed = (this.form === 'box' ? BOX_WALK : WALK) * (this.giant ? 1.25 : 1);
    let mx = 0, mz = 0;
    if (this.enabled && this.locked && !this.chatOpen) {
      if (this.keys.has('KeyW')) mz -= 1;
      if (this.keys.has('KeyS')) mz += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('KeyD')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    let vx = 0, vz = 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
      const rightX = -fwdZ, rightZ = fwdX;
      // mz: W=-1（沿视线前进）；mx: A=-1（左）
      vx = (fwdX * -mz + rightX * mx) * speed;
      vz = (fwdZ * -mz + rightZ * mx) * speed;
    }
    const accel = grounded ? 14 : 5;
    body.velocity.x += (vx - body.velocity.x) * Math.min(1, accel * dt);
    body.velocity.z += (vz - body.velocity.z) * Math.min(1, accel * dt);

    // 跳跃（物化的箱子不能跳）
    if (this.enabled && this.locked && !this.chatOpen
      && this.keys.has('Space') && grounded && this.form === 'human') {
      body.velocity.y = JUMP;
      sfx.play('jump');
    }

    // 墙体边界（补充碰撞，防高速穿墙）
    const p = body.position;
    const r = this.form === 'box' ? BOX_HALF : HUMAN_R;
    p.x = Math.max(ROOM.minX + r, Math.min(ROOM.maxX - r, p.x));
    p.z = Math.max(ROOM.minZ + r, Math.min(ROOM.maxZ - r, p.z));
    if (p.y < -8) { // 掉出世界的兜底
      p.set(0, 2, 0);
      body.velocity.set(0, 0, 0);
    }

    // 视觉与相机
    const footY = p.y - this.footOffset;
    this.visual.position.set(p.x, footY, p.z);
    this.visual.rotation.y = this.yaw + Math.PI; // 面向相机前方

    this._chaosContacts(dt, footY);

    const headY = footY + 1.55;
    const back = 3.4, shoulder = 0.55;
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosP;
    const dirZ = -Math.cos(this.yaw) * cosP;
    const camX = p.x - dirX * back + Math.cos(this.yaw) * shoulder;
    const camZ = p.z - dirZ * back - Math.sin(this.yaw) * shoulder;
    let camY = headY - sinP * back + 0.3;
    camY = Math.max(0.4, Math.min(ROOM.height - 0.3, camY));
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(p.x + dirX * 2, headY + sinP * 2, p.z + dirZ * 2);
  }

  _grounded() {
    const from = this.body.position.clone();
    from.y -= this.footOffset - 0.05;
    const to = from.clone();
    to.y -= 0.22;
    this._rayResult.reset();
    this._ray.from = from;
    this._ray.to = to;
    this._ray.skipBackfaces = true;
    this._ray.intersectWorld(this.game.world, { result: this._rayResult, mode: CANNON.Ray.CLOSEST });
    return this._rayResult.hasHit && this._rayResult.normal.y > 0.35;
  }

  /* ---------------- 事件接触：香蕉皮 / 鸡（设计书 §25） ---------------- */

  _chaosContacts(dt, footY) {
    const t = performance.now();
    const p = this.body.position;

    // 香蕉皮：踩上滑行并上报混乱值（服务器限速）
    if (footY < 0.35 && t - (this._slipAt || 0) > 1400) {
      for (const d of this.game.dynamics.values()) {
        if (d.removed || d.def.kind !== 'banana') continue;
        if (Math.abs(p.x - d.body.position.x) < 0.65 && Math.abs(p.z - d.body.position.z) < 0.65) {
          const sp = Math.hypot(this.body.velocity.x, this.body.velocity.z);
          if (sp > 0.6) {
            this.body.velocity.x *= 2.6;
            this.body.velocity.z *= 2.6;
          } else {
            const a = Math.random() * Math.PI * 2;
            this.body.velocity.x = Math.cos(a) * 7;
            this.body.velocity.z = Math.sin(a) * 7;
          }
          this._slipAt = t;
          this.onSlip?.();
          break;
        }
      }
    }

    // 鸡撞人：本地给自己一个小冲量（每 0.8 秒至多一次）
    if (t - (this._peckAt || 0) > 800) {
      for (const d of this.game.dynamics.values()) {
        if (d.removed || d.def.kind !== 'chicken') continue;
        const dx = p.x - d.body.position.x;
        const dz = p.z - d.body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.85 && dist > 0.01) {
          this.body.velocity.x += (dx / dist) * 3.4;
          this.body.velocity.z += (dz / dist) * 3.4;
          if (this.body.velocity.y < 1) this.body.velocity.y = 2.2;
          this._peckAt = t;
          this.onPeck?.();
          break;
        }
      }
    }
  }

  /* ---------------- 巨型玩家事件 ---------------- */

  setGiant(on) {
    if (this.giant === !!on) return;
    this.giant = !!on;
    this.visual.scale.setScalar(this.giant ? 2 : 1);
  }

  /* ---------------- 物化 ---------------- */

  onToggleMorph() {
    // 由 main 注入
  }

  setForm(form, color) {
    if (this.form === form) return;
    const foot = this.body.position.y - this.footOffset;
    const vel = this.body.velocity.clone();
    const pos = this.body.position.clone();

    this.game.world.removeBody(this.body);
    this.form = form;
    if (form === 'box') {
      this.body = new CANNON.Body({
        mass: 45,
        shape: new CANNON.Box(new CANNON.Vec3(BOX_HALF, BOX_HALF, BOX_HALF)),
        position: new CANNON.Vec3(pos.x, foot + BOX_HALF, pos.z),
        linearDamping: 0.2, angularDamping: 1,
      });
      this.footOffset = BOX_HALF;
    } else {
      this.body = new CANNON.Body({
        mass: 70,
        shape: new CANNON.Sphere(HUMAN_R),
        position: new CANNON.Vec3(pos.x, foot + HUMAN_R, pos.z),
        linearDamping: 0.12, angularDamping: 1,
      });
      this.footOffset = HUMAN_R;
    }
    this.body.fixedRotation = true;
    this.body.updateMassProperties();
    this.body.velocity.copy(vel);
    this.game.world.addBody(this.body);

    this.game.scene.remove(this.visual);
    this.visual = buildPlayerMesh(color || '#ff6b6b', form);
    if (this.giant) this.visual.scale.setScalar(2);
    this.game.scene.add(this.visual);
  }

  _setFormInstant(form) {
    this.form = form;
    this.footOffset = form === 'box' ? BOX_HALF : HUMAN_R;
    if (this.body) this.game.world.removeBody(this.body);
    this.body = this._makeBody(HUMAN_R, 70);
  }

  /* ---------------- 输出 ---------------- */

  pose() {
    const p = this.body.position;
    return {
      x: +p.x.toFixed(3),
      y: +(p.y - this.footOffset).toFixed(3),
      z: +p.z.toFixed(3),
      yaw: +this.yaw.toFixed(3),
    };
  }

  camDir() {
    const cosP = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cosP,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosP
    ).normalize();
  }

  blast() {
    this.body.velocity.x += (Math.random() - 0.5) * 9;
    this.body.velocity.y = 6 + Math.random() * 5;
    this.body.velocity.z += (Math.random() - 0.5) * 9;
  }
}

const ROOM_SPAWN_DEFAULT = [0, 2, 0];
