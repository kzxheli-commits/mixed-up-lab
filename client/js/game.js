// Three.js 场景 + cannon-es 物理世界 + 关卡几何 + 动态物体 + 远端玩家
import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { ROOM, SIDE_ROOM, PLATFORM, NPC, CORE_POS, EXIT, ORB_HOME } from './level.js';

const FORM_MASS = (tags) => (tags.includes('LIGHT') ? 3 : tags.includes('HEAVY') ? 12 : 6);

/* ---------------- 程序纹理（避免灰盒，明亮卡通） ---------------- */

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'));
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function floorTexture() {
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#5a6b7f'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let x = 16; x < 256; x += 64) {
      for (let y = 16; y < 256; y += 64) { g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, 256, 8);
  });
  tex.repeat.set(10, 8);
  return tex;
}

function wallTexture() {
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#dfe7ef'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(90,110,130,0.45)'; g.lineWidth = 4;
    g.strokeRect(2, 2, 252, 252);
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
    g.fillStyle = 'rgba(120,140,160,0.35)';
    for (const [x, y] of [[10, 10], [246, 10], [10, 246], [246, 246]]) {
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, 0, 256, 6);
  });
  tex.repeat.set(5, 2);
  return tex;
}

/* ---------------- 动态物体外观（随标签变化） ---------------- */

function buildObjectMesh(def, form) {
  const [sx, sy, sz] = def.size;
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#c98d4b', roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: '#8fa3b8', roughness: 0.4, metalness: 0.5 });

  if (form === 'CHAIR') {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.1, sz), wood);
    seat.position.y = sy * 0.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(sx, sy * 0.5, 0.08), wood);
    back.position.set(0, sy * 0.75, -sz / 2 + 0.05);
    group.add(seat, back);
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, sy * 0.5, 0.07), metal);
        leg.position.set((dx * sx) / 2.6, sy * 0.25, (dz * sz) / 2.6);
        group.add(leg);
      }
    }
  } else if (form === 'SPRING') {
    const coilMat = new THREE.MeshStandardMaterial({ color: '#ff922b', roughness: 0.35, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(sx * 0.38, 0.05, 8, 20), coilMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = (i + 0.5) * (sy / 4.4);
      group.add(coil);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.45, sx * 0.45, 0.1, 18), metal);
    cap.position.y = sy - 0.05;
    group.add(cap);
  } else if (form === 'LAMP') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.4, sx * 0.5, 0.1, 16), metal);
    base.position.y = 0.05;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, sy * 0.7, 10), metal);
    pole.position.y = sy * 0.4;
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(sx * 0.55, sy * 0.4, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffd43b', emissiveIntensity: 0.8, side: THREE.DoubleSide })
    );
    shade.position.y = sy * 0.85;
    group.add(base, pole, shade);
  } else {
    // BOX / ORB / 默认
    const mat = form === 'ORB'
      ? new THREE.MeshStandardMaterial({ color: '#74c0fc', emissive: '#4dabf7', emissiveIntensity: 0.55, roughness: 0.3 })
      : wood;
    const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    group.add(box);
    if (form === 'BOX') {
      const edgeMat = new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.9 });
      const t = 0.05;
      for (const dy of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, t * 2, sz + 0.02), edgeMat);
        bar.position.y = (dy * sy) / 2 - t;
        group.add(bar);
      }
    }
  }

  // 关键物发光标记（任何形式都发光，方便找能源球）
  if (def.key) {
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 10),
      new THREE.MeshBasicMaterial({ color: '#e3fafc' })
    );
    glow.position.y = sy * 0.75;
    glow.userData.glow = true;
    group.add(glow);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

/* ---------------- 远端玩家外观 ---------------- */

export function buildPlayerMesh(color, form) {
  const g = new THREE.Group();
  if (form === 'box') {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: '#c98d4b', roughness: 0.85 })
    );
    m.position.y = 0.4;
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.2, 0.82),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
    );
    mark.position.y = 0.68;
    g.add(m, mark);
  } else {
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 6, 14), bodyMat);
    body.position.y = 0.67;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 18, 14),
      new THREE.MeshStandardMaterial({ color: '#ffe8d6', roughness: 0.7 })
    );
    head.position.y = 1.52;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.14, 0.1),
      new THREE.MeshStandardMaterial({ color: '#22303f', roughness: 0.2, metalness: 0.4 })
    );
    visor.position.set(0, 1.55, 0.29);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: '#ffd43b' })
    );
    antenna.position.y = 1.9;
    g.add(body, head, visor, antenna);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function nameSprite(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 30px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(240, g.measureText(name).width + 30);
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 12); g.fill();
  g.fillStyle = color;
  g.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  sp.position.y = 2.15;
  return sp;
}

/* ================= Game ================= */

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101a2a');
    this.scene.fog = new THREE.Fog('#101a2a', 30, 70);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.05;

    this.dynamics = new Map();  // id -> {def, form, tags, mesh, body, sim, target}
    this.remotes = new Map();   // id -> {group, name, pos, yaw, form, body}
    this.doors = {};
    this.npc = null;
    this.coreGroup = null;
    this.plateMesh = null;
    this.exitSign = null;
    this.springCooldown = new Map();
    this.listeners = { collide: [] };

    this._buildLights();
    this._buildRoom();
    this._buildFurniture();
    this._buildPuzzleProps();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera && (this.camera.aspect = innerWidth / innerHeight);
    this.camera && this.camera.updateProjectionMatrix();
  }

  /* ---------------- 灯光 ---------------- */

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe8ff', '#2a3a4d', 0.85));
    const sun = new THREE.DirectionalLight('#fff6dd', 1.35);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    this.scene.add(sun);

    for (const x of [-6, 0, 6]) {
      const lamp = new THREE.PointLight('#eaf6ff', 0.5, 18);
      lamp.position.set(x, 4.6, 0);
      this.scene.add(lamp);
      const bulb = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.12, 0.8),
        new THREE.MeshBasicMaterial({ color: '#f8fbff' })
      );
      bulb.position.set(x, 4.92, 0);
      this.scene.add(bulb);
    }
  }

  /* ---------------- 关卡静态几何 ---------------- */

  _addStaticBox(size, pos, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
      position: new CANNON.Vec3(...pos),
    });
    this.world.addBody(body);
    if (opts.noBody) { this.world.removeBody(body); return { mesh, body: null }; }
    return { mesh, body };
  }

  _buildRoom() {
    const W = ROOM.maxX - ROOM.minX;
    const D = ROOM.maxZ - ROOM.minZ;
    const cx = (ROOM.maxX + ROOM.minX) / 2;
    const cz = (ROOM.maxZ + ROOM.minZ) / 2;
    const H = ROOM.height;

    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.world.addBody(new CANNON.Body({
      mass: 0, shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, 0, 0),
      quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0),
    }));

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.8 });
    const t = ROOM.wall;

    // 北墙 / 南墙（南墙在侧室处断开）
    this._addStaticBox([W + t * 2, H, t], [cx, H / 2, ROOM.minZ - t / 2], wallMat);
    const srW = SIDE_ROOM.x1 - SIDE_ROOM.x0;
    const southLeftW = SIDE_ROOM.x0 - ROOM.minX;
    this._addStaticBox([southLeftW, H, t], [ROOM.minX + southLeftW / 2, H / 2, ROOM.maxZ + t / 2], wallMat);
    const southRightW = ROOM.maxX - SIDE_ROOM.x1;
    this._addStaticBox([southRightW, H, t], [SIDE_ROOM.x1 + southRightW / 2, H / 2, ROOM.maxZ + t / 2], wallMat);
    // 南墙门上过梁
    this._addStaticBox([srW, H - 3, t], [SIDE_ROOM.x0 + srW / 2, 3 + (H - 3) / 2, ROOM.maxZ + t / 2], wallMat);

    // 西墙
    this._addStaticBox([t, H, D], [ROOM.minX - t / 2, H / 2, cz], wallMat);
    // 东墙（出口门洞 z∈[-2,2]）
    const eastA = (EXIT.z0 - ROOM.minZ);
    this._addStaticBox([t, H, eastA], [ROOM.maxX + t / 2, H / 2, ROOM.minZ + eastA / 2], wallMat);
    const eastB = (ROOM.maxZ - EXIT.z1);
    this._addStaticBox([t, H, eastB], [ROOM.maxX + t / 2, H / 2, ROOM.maxZ - eastB / 2], wallMat);
    // 门上过梁
    this._addStaticBox([t, H - 3.2, EXIT.z1 - EXIT.z0], [ROOM.maxX + t / 2, 3.2 + (H - 3.2) / 2, 0], wallMat);

    // 天花板
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: '#26344b', roughness: 0.95 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    this.scene.add(ceil);
    this.world.addBody(new CANNON.Body({
      mass: 0, shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, H, 0),
      quaternion: new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0),
    }));

    // 黄黑安全边条（沿四周）
    const stripe = new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.6 });
    const edge = 0.18;
    for (const [w, d, x, z] of [
      [W, edge, cx, ROOM.minZ + 0.35],
      [W, edge, cx, ROOM.maxZ - 0.35],
      [edge, D, ROOM.minX + 0.35, cz],
      [edge, D, ROOM.maxX - 0.35, cz],
    ]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), stripe);
      s.position.set(x, 0.02, z);
      this.scene.add(s);
    }

    // 蓝色管线（北墙高处）
    const pipeMat = new THREE.MeshStandardMaterial({ color: '#4dabf7', roughness: 0.35, metalness: 0.4 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, W - 1, 12), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(cx, 3.6, ROOM.minZ + 0.32);
    this.scene.add(pipe);
    const pipe2 = pipe.clone();
    pipe2.position.y = 3.95;
    pipe2.scale.setScalar(0.7);
    this.scene.add(pipe2);

    // 观察窗（北墙发光窗）
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.6),
      new THREE.MeshBasicMaterial({ color: '#8fd3ff' })
    );
    win.position.set(cx, 2.6, ROOM.minZ + 0.23);
    this.scene.add(win);

    // 出口门板（exitOpen 上滑）
    const doorMat = new THREE.MeshStandardMaterial({ color: '#9fb2c9', roughness: 0.4, metalness: 0.55 });
    const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, EXIT.z1 - EXIT.z0), doorMat);
    exitDoor.position.set(ROOM.maxX - 0.02, 1.6, 0);
    exitDoor.castShadow = true;
    this.scene.add(exitDoor);
    const exitBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(0.15, 1.6, (EXIT.z1 - EXIT.z0) / 2)),
      position: new CANNON.Vec3(ROOM.maxX - 0.02, 1.6, 0),
    });
    this.world.addBody(exitBody);
    this.doors.exit = { mesh: exitDoor, body: exitBody, closedY: 1.6, open: false };

    // EXIT 灯箱
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, 1.8),
      new THREE.MeshBasicMaterial({ color: '#ff6b6b' })
    );
    sign.position.set(ROOM.maxX - 0.25, 3.5, 0);
    this.scene.add(sign);
    this.exitSign = sign;

    // 侧室隔断（含门洞）：左段 + 右段 + 过梁
    const innerMat = new THREE.MeshStandardMaterial({ color: '#cbd6e2', roughness: 0.85 });
    const doorW = 1.8;
    const segW = (srW - doorW) / 2;
    this._addStaticBox([segW, H, t], [SIDE_ROOM.x0 + segW / 2, H / 2, SIDE_ROOM.z0 - t / 2], innerMat);
    this._addStaticBox([segW, H, t], [SIDE_ROOM.x1 - segW / 2, H / 2, SIDE_ROOM.z0 - t / 2], innerMat);
    this._addStaticBox([doorW, H - 2.6, t], [SIDE_ROOM.doorX, 2.6 + (H - 2.6) / 2, SIDE_ROOM.z0 - t / 2], innerMat);
    // 侧室侧墙
    this._addStaticBox([t, H, SIDE_ROOM.z1 - SIDE_ROOM.z0 + t], [SIDE_ROOM.x0 - t / 2, H / 2, (SIDE_ROOM.z0 + SIDE_ROOM.z1) / 2], innerMat);
    this._addStaticBox([t, H, SIDE_ROOM.z1 - SIDE_ROOM.z0 + t], [SIDE_ROOM.x1 + t / 2, H / 2, (SIDE_ROOM.z0 + SIDE_ROOM.z1) / 2], innerMat);

    const sideDoor = new THREE.Mesh(new THREE.BoxGeometry(doorW, 2.6, 0.18), doorMat);
    sideDoor.position.set(SIDE_ROOM.doorX, 1.3, SIDE_ROOM.z0);
    sideDoor.castShadow = true;
    this.scene.add(sideDoor);
    const sideBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(doorW / 2, 1.3, 0.09)),
      position: new CANNON.Vec3(SIDE_ROOM.doorX, 1.3, SIDE_ROOM.z0),
    });
    this.world.addBody(sideBody);
    this.doors.side = { mesh: sideDoor, body: sideBody, closedY: 1.3, open: false };

    // 出口外地坪（视觉延伸）
    const beyond = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 5),
      new THREE.MeshBasicMaterial({ color: '#bafbe5' })
    );
    beyond.rotation.x = -Math.PI / 2;
    beyond.position.set(ROOM.maxX + 3, 0.01, 0);
    this.scene.add(beyond);
  }

  _buildFurniture() {
    // 高台（能源球）
    const platMat = new THREE.MeshStandardMaterial({ color: '#7b8ba1', roughness: 0.7, metalness: 0.3 });
    this._addStaticBox(
      [PLATFORM.x1 - PLATFORM.x0, PLATFORM.h, PLATFORM.z1 - PLATFORM.z0],
      [(PLATFORM.x0 + PLATFORM.x1) / 2, PLATFORM.h / 2, (PLATFORM.z0 + PLATFORM.z1) / 2],
      platMat
    );
    const platTop = new THREE.Mesh(
      new THREE.BoxGeometry(PLATFORM.x1 - PLATFORM.x0 + 0.1, 0.06, PLATFORM.z1 - PLATFORM.z0 + 0.1),
      new THREE.MeshStandardMaterial({ color: '#ffd43b' })
    );
    platTop.position.set((PLATFORM.x0 + PLATFORM.x1) / 2, PLATFORM.h + 0.03, (PLATFORM.z0 + PLATFORM.z1) / 2);
    this.scene.add(platTop);

    // 实验台（可站立）
    const tableMat = new THREE.MeshStandardMaterial({ color: '#4d9fe0', roughness: 0.55 });
    this._addStaticBox([3.2, 0.9, 1.2], [-3.5, 0.45, -6.5], tableMat);
    this._addStaticBox([2.4, 1.0, 1.0], [2.5, 0.5, -6.8], new THREE.MeshStandardMaterial({ color: '#e85d75', roughness: 0.6 }));

    // 货架（侧室内视觉 + 主厅角落）
    const shelfMat = new THREE.MeshStandardMaterial({ color: '#6c7d94', roughness: 0.6, metalness: 0.4 });
    this._addStaticBox([0.5, 2.2, 3.0], [ROOM.minX + 0.45, 1.1, -2.5], shelfMat);
    for (let i = 0; i < 3; i++) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#ffb703' : '#8ecae6', roughness: 0.8 })
      );
      crate.position.set(ROOM.minX + 0.9, 0.3 + i * 0.62, -3.4 + i * 0.8);
      crate.castShadow = true;
      this.scene.add(crate);
    }

    // 天花板风扇（动画）
    this.fan = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.05, 0.3),
        new THREE.MeshStandardMaterial({ color: '#9aa9bd', metalness: 0.5, roughness: 0.4 })
      );
      blade.position.x = 0.7;
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI * 2) / 3;
      arm.add(blade);
      this.fan.add(arm);
    }
    this.fan.position.set(0, 4.7, 5);
    this.scene.add(this.fan);

    // 压力板
    this.plateMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.9, 0.07, 24),
      new THREE.MeshStandardMaterial({ color: '#e85d75', emissive: '#e85d75', emissiveIntensity: 0.35 })
    );
    this.plateMesh.position.set(0, 0.04, 6);
    this.scene.add(this.plateMesh);
  }

  _buildPuzzleProps() {
    // 疯狂实验员
    const g = new THREE.Group();
    const coat = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.75, 6, 14),
      new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.7 })
    );
    coat.position.y = 0.78;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 18, 14),
      new THREE.MeshStandardMaterial({ color: '#ffe8d6', roughness: 0.7 })
    );
    head.position.y = 1.5;
    const glasses = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.12, 0.1),
      new THREE.MeshStandardMaterial({ color: '#22303f', metalness: 0.5, roughness: 0.2 })
    );
    glasses.position.set(0, 1.53, 0.26);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#d0d5dc', roughness: 0.9 })
    );
    hair.position.y = 1.68;
    const hair2 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), hair.material);
    hair2.position.set(0.2, 1.8, 0);
    g.add(coat, head, glasses, hair, hair2);
    g.position.set(...NPC.pos);
    g.rotation.y = NPC.look;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.npc = { group: g, seatY: 0 };
    // NPC 气泡
    const bubbleCv = document.createElement('canvas');
    bubbleCv.width = 512; bubbleCv.height = 160;
    const bg = bubbleCv.getContext('2d');
    bg.font = 'bold 44px "Microsoft YaHei", sans-serif';
    bg.textAlign = 'center';
    bg.fillStyle = 'rgba(255,255,255,0.95)';
    bg.beginPath(); bg.roundRect(6, 6, 500, 110, 30); bg.fill();
    bg.fillStyle = '#22303f';
    bg.fillText('我需要一把椅子！', 256, 78);
    const bubbleTex = new THREE.CanvasTexture(bubbleCv);
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, depthTest: false }));
    bubble.scale.set(2.6, 0.82, 1);
    bubble.position.y = 2.4;
    g.add(bubble);
    this.npc.bubble = bubble;

    // 核心插槽
    const cg = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, 1.1, 20),
      new THREE.MeshStandardMaterial({ color: '#55677d', roughness: 0.5, metalness: 0.5 })
    );
    base.position.y = 0.55;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.09, 10, 30),
      new THREE.MeshStandardMaterial({ color: '#ff922b', emissive: '#ff922b', emissiveIntensity: 0.5 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.15;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 14),
      new THREE.MeshStandardMaterial({ color: '#3b536e', emissive: '#20304a', emissiveIntensity: 0.6 })
    );
    orb.position.y = 1.5;
    cg.add(base, ring, orb);
    cg.position.set(CORE_POS[0], 0, CORE_POS[2]);
    cg.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.scene.add(cg);
    this.coreGroup = { group: cg, orb, ring };

    // 核心可站立基座
    this.world.addBody(new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(0.9, 1.1, 1.1, 14),
      position: new CANNON.Vec3(CORE_POS[0], 0.55, CORE_POS[2]),
    }));
  }

  /* ---------------- 动态物体 ---------------- */

  spawnObjects(defs) {
    for (const d of this.dynamics.values()) {
      this.scene.remove(d.mesh);
      this.world.removeBody(d.body);
    }
    this.dynamics.clear();
    for (const def of defs) {
      const form = def.form;
      const mesh = buildObjectMesh(def, form);
      mesh.position.set(...def.p);
      this.scene.add(mesh);
      const body = this._makeBody(def, form, def.tags, def.p, def.q);
      this.dynamics.set(def.id, {
        def, form, tags: [...def.tags], mesh, body, sim: null, target: null, removed: false,
      });
    }
  }

  _shapeFor(def) {
    const [sx, sy, sz] = def.size;
    if (def.key && def.form === 'ORB') return new CANNON.Sphere(Math.max(sx, sy, sz) / 2);
    if (def.form === 'ORB') return new CANNON.Sphere(sx / 2);
    if (def.form === 'SPRING' || def.form === 'LAMP') return new CANNON.Box(new CANNON.Vec3(sx / 3, sy / 2, sz / 3));
    return new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2));
  }

  _makeBody(def, form, tags, p, q) {
    const staticTag = tags.includes('STATIC');
    const body = new CANNON.Body({
      mass: staticTag ? 0 : FORM_MASS(tags),
      shape: this._shapeFor({ ...def, form }),
      position: new CANNON.Vec3(p[0], p[1], p[2]),
      linearDamping: 0.25,
      angularDamping: 0.55,
    });
    if (q) body.quaternion.set(q[0], q[1], q[2], q[3]);
    if (staticTag) body.type = CANNON.Body.STATIC;
    this.world.addBody(body);
    return body;
  }

  applyTag(id, form, tags) {
    const d = this.dynamics.get(id);
    if (!d || d.removed) return;
    const pos = d.body.position;
    const quat = d.body.quaternion;
    this.world.removeBody(d.body);
    this.scene.remove(d.mesh);
    d.form = form;
    d.tags = [...tags];
    d.def = { ...d.def, form };
    d.mesh = buildObjectMesh({ ...d.def, size: this._sizeFor(id) }, form);
    d.mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(d.mesh);
    d.body = this._makeBody({ ...d.def, size: this._sizeFor(id) }, form, tags,
      [pos.x, pos.y, pos.z], [quat.x, quat.y, quat.z, quat.w]);
    // 按当前模拟权重恢复 body 类型（重建的 body 默认 DYNAMIC）
    if (d.sim !== this.myId) d.body.type = CANNON.Body.KINEMATIC;
    else d.body.allowSleep = !d.heldBy;
    return d;
  }

  _sizeFor(id) {
    const d = this.dynamics.get(id);
    return d?.def.size || [0.8, 0.8, 0.8];
  }

  removeObject(id) {
    const d = this.dynamics.get(id);
    if (!d) return;
    d.removed = true;
    this.scene.remove(d.mesh);
    this.world.removeBody(d.body);
    this.dynamics.delete(id);
  }

  setSim(id, sim) {
    const d = this.dynamics.get(id);
    if (!d) return;
    if (d.sim === sim) return;
    d.sim = sim;
    const mine = sim === this.myId;
    if (mine) {
      if (d.body.type !== CANNON.Body.DYNAMIC && !d.heldBy) d.body.type = CANNON.Body.DYNAMIC;
      d.body.mass = FORM_MASS(d.tags);
      d.body.updateMassProperties();
    } else if (!d.heldBy) {
      d.body.type = CANNON.Body.KINEMATIC;
    }
  }

  /* ---------------- 门 / 谜题视觉 ---------------- */

  setPuzzle(puzzle) {
    this.doors.exit && (this.doors.exit.open = puzzle.exitOpen);
    this.doors.side && (this.doors.side.open = puzzle.sideDoorOpen);

    if (this.npc) {
      this.npc.bubble.visible = !puzzle.chairGiven;
      const target = puzzle.chairGiven ? -0.45 : 0;
      this.npc.seatY = target; // step 中 lerp
    }
    if (this.coreGroup) {
      const on = puzzle.corePowered;
      const mat = this.coreGroup.orb.material;
      mat.color.set(on ? '#63e6be' : '#3b536e');
      mat.emissive.set(on ? '#12b886' : '#20304a');
      mat.emissiveIntensity = on ? 1.4 : 0.6;
      this.coreGroup.ring.material.emissive.set(on ? '#38d9a9' : '#ff922b');
    }
    if (this.exitSign) {
      this.exitSign.material.color.set(puzzle.exitOpen ? '#51cf66' : '#ff6b6b');
    }
    if (this.plateMesh) {
      this.plateMesh.material.color.set(puzzle.sideDoorOpen ? '#51cf66' : '#e85d75');
      this.plateMesh.material.emissive.set(puzzle.sideDoorOpen ? '#51cf66' : '#e85d75');
    }
  }

  /* ---------------- 远端玩家 ---------------- */

  setRemotePlayers(players, myId) {
    this.myId = myId;
    const seen = new Set();
    for (const p of players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const group = new THREE.Group();
        group.add(nameSprite(p.name, p.color));
        // 本地碰撞体（让本地物理能撞到其他玩家）
        const body = new CANNON.Body({
          mass: 0, type: CANNON.Body.KINEMATIC,
          shape: new CANNON.Sphere(0.42),
          position: new CANNON.Vec3(p.x, p.y + 0.42, p.z),
        });
        this.world.addBody(body);
        r = { group, visual: null, form: null, color: p.color, pos: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, body };
        this.scene.add(group);
        this.remotes.set(p.id, r);
      }
      // 形态切换：重建碰撞体（cannon 不允许直接改 shapes 数组）
      if (r.form !== p.form) {
        r.form = p.form;
        if (r.visual) r.group.remove(r.visual);
        r.visual = buildPlayerMesh(p.color, p.form);
        r.group.add(r.visual);
        this.world.removeBody(r.body);
        r.body = new CANNON.Body({
          mass: 0, type: CANNON.Body.KINEMATIC,
          shape: p.form === 'box'
            ? new CANNON.Box(new CANNON.Vec3(0.4, 0.4, 0.4))
            : new CANNON.Sphere(0.42),
          position: new CANNON.Vec3(r.pos.x, r.pos.y + (p.form === 'box' ? 0.4 : 0.42), r.pos.z),
        });
        this.world.addBody(r.body);
      }
      r.targetPos = new THREE.Vector3(p.x, p.y, p.z);
      r.targetYaw = p.yaw;
      r.dc = p.dc;
      if (r.visual) {
        r.visual.traverse((o) => {
          if (!o.material) return;
          o.material.transparent = true;
          o.material.opacity = p.dc ? 0.45 : 1;
        });
      }
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.group);
        this.world.removeBody(r.body);
        this.remotes.delete(id);
      }
    }
  }

  /* ---------------- 混乱模式 ---------------- */

  chaosBlast() {
    for (const d of this.dynamics.values()) {
      if (d.body.type === CANNON.Body.DYNAMIC) {
        d.body.velocity.set((Math.random() - 0.5) * 12, 6 + Math.random() * 8, (Math.random() - 0.5) * 12);
        d.body.angularVelocity.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      }
    }
    this.onBlast?.();
  }

  /* ---------------- 每帧 ---------------- */

  step(dt, localBody) {
    this.world.step(1 / 60, Math.min(dt, 0.05), 3);

    // 门动画
    for (const door of Object.values(this.doors)) {
      const targetY = door.open ? door.closedY + 3.0 : door.closedY;
      door.mesh.position.y += (targetY - door.mesh.position.y) * Math.min(1, dt * 5);
      if (Math.abs(door.body.position.y - door.mesh.position.y) > 0.01) {
        door.body.position.y = door.mesh.position.y;
        door.body.aabbNeedsUpdate = true;
        door.body.dirty = true;
      }
    }

    // NPC 坐下动画
    if (this.npc) {
      const g = this.npc.group;
      g.position.y += (this.npc.seatY - g.position.y) * Math.min(1, dt * 4);
    }

    // 风扇
    if (this.fan) this.fan.rotation.y += dt * 2.2;

    // 动态物体：同步视觉；非模拟者做插值
    for (const d of this.dynamics.values()) {
      if (d.removed) continue;
      if (d.sim !== this.myId && d.targetPos) {
        const b = d.body.position;
        const k = Math.min(1, dt * 14);
        b.x += (d.targetPos.x - b.x) * k;
        b.y += (d.targetPos.y - b.y) * k;
        b.z += (d.targetPos.z - b.z) * k;
        if (d.targetQuat) d.body.quaternion.slerp(d.targetQuat, k, d.body.quaternion);
        d.body.velocity.set(0, 0, 0);
      }
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      // 发光脉冲
      d.mesh.traverse((o) => {
        if (o.userData.glow) o.scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.25);
      });
    }

    // 远端玩家插值
    for (const r of this.remotes.values()) {
      if (r.targetPos) {
        const k = Math.min(1, dt * 12);
        r.pos.lerp(r.targetPos, k);
        let dy = r.targetYaw - r.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        r.yaw += dy * k;
      }
      r.group.position.copy(r.pos);
      r.group.rotation.y = r.yaw;
      r.body.position.set(r.pos.x, r.pos.y + 0.42, r.pos.z);
      r.body.aabbNeedsUpdate = true;
    }

    // 弹簧跳跃（本地玩家）
    if (localBody) {
      for (const d of this.dynamics.values()) {
        if (d.form !== 'SPRING' || d.removed) continue;
        const last = this.springCooldown.get(d.id) || 0;
        if (performance.now() - last < 450) continue;
        const bp = d.body.position;
        const lp = localBody.position;
        const top = bp.y + d.def.size[1] / 2;
        if (Math.abs(lp.x - bp.x) < 0.7 && Math.abs(lp.z - bp.z) < 0.7
          && lp.y >= top - 0.35 && lp.y <= top + 0.7 && localBody.velocity.y <= 0.5) {
          localBody.velocity.y = 13.5;
          this.springCooldown.set(d.id, performance.now());
          this.onSpring?.();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateObjTargets(items) {
    for (const it of items) {
      const d = this.dynamics.get(it.id);
      if (!d || d.removed) continue;
      d.targetPos = new THREE.Vector3(it.p[0], it.p[1], it.p[2]);
      d.targetQuat = new THREE.Quaternion(it.q[0], it.q[1], it.q[2], it.q[3]);
      // 注意：d.sim 只由 setSim 负责写入并切换 body 类型，这里不碰
    }
  }
}

export { buildObjectMesh, FORM_MASS };
