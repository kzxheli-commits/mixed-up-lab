// Three.js 场景 + cannon-es 物理世界 + 关卡几何 + 动态物体 + 远端玩家
import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { ROOM, SIDE_ROOM, PLATFORM, NPC, CORE_POS, EXIT, ORB_HOME, BUTTONS } from './level.js';

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

// 程序纹理缓存（木箱、金属件共用）
let _woodTex = null;
function woodTexture() {
  if (_woodTex) return _woodTex;
  _woodTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#c98d4b'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = `rgba(122,74,34,${0.14 + Math.random() * 0.1})`;
      g.fillRect(0, y, 128, 3);
      g.fillStyle = 'rgba(255,220,170,0.12)';
      g.fillRect(0, y + 4, 128, 2);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(90,55,20,${Math.random() * 0.18})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 8, 1.5);
    }
    // 节疤
    g.strokeStyle = 'rgba(90,55,20,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(84, 52, 9, 5, 0.4, 0, 7); g.stroke();
  });
  _woodTex.wrapS = _woodTex.wrapT = THREE.RepeatWrapping;
  return _woodTex;
}

let _metalNoise = null;
function metalRoughness() {
  if (_metalNoise) return _metalNoise;
  _metalNoise = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 220; i++) {
      const v = 110 + Math.random() * 100;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1);
    }
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.15})`;
      g.beginPath();
      const x = Math.random() * 128, y = Math.random() * 128;
      g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 14);
      g.stroke();
    }
  });
  _metalNoise.wrapS = _metalNoise.wrapT = THREE.RepeatWrapping;
  return _metalNoise;
}

// 窗外远景：渐变天空 + 建筑剪影（设计书 §57 远景让地图显得更大）
let _viewTex = null;
function windowView() {
  if (_viewTex) return _viewTex;
  _viewTex = canvasTexture(512, 256, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#7ec8ff');
    sky.addColorStop(0.55, '#cfe9ff');
    sky.addColorStop(1, '#eaf6ff');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
    // 远处建筑剪影
    const buildings = [[0, 140, 70, 116], [64, 100, 54, 156], [110, 160, 90, 96], [196, 120, 64, 136], [252, 84, 78, 172], [324, 150, 60, 106], [378, 112, 72, 144], [444, 166, 68, 90]];
    for (const [x, y, w, h] of buildings) {
      g.fillStyle = 'rgba(70,96,130,0.85)';
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,244,190,0.75)';
      for (let wx = x + 8; wx < x + w - 6; wx += 16) {
        for (let wy = y + 10; wy < y + h - 8; wy += 22) {
          if (Math.random() > 0.4) g.fillRect(wx, wy, 6, 8);
        }
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.ellipse(420, 46, 60, 22, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(120, 60, 44, 16, 0, 0, 7); g.fill();
  });
  return _viewTex;
}

/* ---------------- 动态物体外观（随标签变化） ---------------- */

function buildObjectMesh(def, form) {
  const [sx, sy, sz] = def.size;
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.78 });
  const metal = new THREE.MeshStandardMaterial({
    color: '#9fb2c9', roughness: 0.42, metalness: 0.6, roughnessMap: metalRoughness(),
  });

  // 事件物体：鸡 / 香蕉皮
  if (def.kind === 'chicken') {
    const yellow = new THREE.MeshStandardMaterial({ color: '#ffe066', roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), yellow);
    body.scale.set(1, 0.9, 1.25);
    body.position.y = 0.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), yellow);
    head.position.set(0, 0.4, 0.2);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: '#ff922b' }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.4, 0.34);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshStandardMaterial({ color: '#ff6b6b' }));
    comb.position.set(0, 0.52, 0.18);
    group.add(body, head, beak, comb);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return group;
  }
  if (def.kind === 'banana') {
    const peel = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.05, 8, 14, Math.PI * 1.2),
      new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.55 })
    );
    peel.rotation.x = -Math.PI / 2;
    peel.rotation.z = Math.random() * Math.PI;
    peel.position.y = 0.03;
    group.add(peel);
    return group;
  }

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

/* ---------------- 远端/本地玩家外观（设计书 §13：大头、四肢、高辨识度） ---------------- */

export function buildPlayerMesh(color, form) {
  const g = new THREE.Group();
  if (form === 'box') {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.8 })
    );
    m.position.y = 0.4;
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.2, 0.84),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
    );
    mark.position.y = 0.68;
    g.add(m, mark);
    return g;
  }

  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: '#ffe8d6', roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: '#33415c', roughness: 0.75 });

  // 腿（髋部为轴，走路摆动）
  const legGeo = new THREE.CylinderGeometry(0.085, 0.07, 0.5, 10);
  const legs = [];
  for (const dx of [-0.13, 0.13]) {
    const hip = new THREE.Group();
    hip.position.set(dx, 0.52, 0);
    const leg = new THREE.Mesh(legGeo, pants);
    leg.position.y = -0.25;
    hip.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.22), pants);
    shoe.position.set(0, -0.52, 0.04);
    hip.add(shoe);
    g.add(hip);
    legs.push(hip);
  }

  // 身体（短胶囊，给腿留空间）
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.34, 6, 14), suit);
  body.position.y = 0.86;
  g.add(body);
  // 工具腰带（辨识装饰）
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.34),
    new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.55 }));
  belt.position.y = 0.7;
  g.add(belt);

  // 手臂（肩部为轴）
  const armGeo = new THREE.CylinderGeometry(0.065, 0.06, 0.42, 10);
  const arms = [];
  for (const dx of [-0.3, 0.3]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(dx, 1.04, 0);
    const arm = new THREE.Mesh(armGeo, suit);
    arm.position.y = -0.2;
    shoulder.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin);
    hand.position.y = -0.44;
    shoulder.add(hand);
    g.add(shoulder);
    arms.push(shoulder);
  }

  // 大头 + 眼睛 + 天线
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 14), skin);
  head.position.y = 1.5;
  g.add(head);
  const eyeW = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const eyeB = new THREE.MeshBasicMaterial({ color: '#1c2733' });
  for (const dx of [-0.12, 0.12]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeW);
    w.position.set(dx, 1.54, 0.27);
    w.scale.set(1, 1.15, 0.6);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeB);
    b.position.set(dx, 1.54, 0.325);
    g.add(w, b);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6),
    new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.5 }));
  antenna.position.y = 1.86;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color }));
  tip.position.y = 1.99;
  g.add(antenna, tip);

  g.userData.armL = arms[0];
  g.userData.armR = arms[1];
  g.userData.legL = legs[0];
  g.userData.legR = legs[1];
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// 行走摆动动画（速度驱动）
export function animateAvatar(group, speed, t) {
  const ud = group.userData;
  if (!ud.armL) return;
  const swing = Math.sin(t * 9) * Math.min(Math.max(speed, 0), 6) * 0.11;
  ud.armL.rotation.x = swing;
  ud.armR.rotation.x = -swing;
  ud.legL.rotation.x = -swing;
  ud.legR.rotation.x = swing;
}

// NPC 头顶气泡（台词随服务器快照更新）
function buildBubble(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const g = cv.getContext('2d');
  g.textAlign = 'center';
  let fs = 42;
  g.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
  let w = g.measureText(text).width + 60;
  while (fs > 20 && w > 496) {
    fs -= 2;
    g.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
    w = g.measureText(text).width + 60;
  }
  w = Math.min(496, w);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.roundRect((512 - w) / 2, 8, w, 104, 28); g.fill();
  g.fillStyle = '#22303f';
  g.fillText(text, 256, 74);
  return new THREE.CanvasTexture(cv);
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
    // 电影级色调映射：去掉"灰塑料感"（设计书 §38 色彩明快、光照柔和）
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

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
    this._buildProps();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera && (this.camera.aspect = innerWidth / innerHeight);
    this.camera && this.camera.updateProjectionMatrix();
  }

  /* ---------------- 灯光（设计书 §52：明亮、柔和、彩色） ---------------- */

  _buildLights() {
    // 天光 + 地面反弹：整体提亮，消灭天花板死黑
    this.scene.add(new THREE.HemisphereLight('#e8f4ff', '#5e6f85', 1.15));

    // 主方向光（阴影）
    const sun = new THREE.DirectionalLight('#fff6dd', 1.7);
    sun.position.set(9, 15, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    // 北窗进光（冷色补光，给窗户一侧体积感）
    const windowLight = new THREE.DirectionalLight('#bcd8ff', 0.55);
    windowLight.position.set(-2, 7, -16);
    windowLight.target.position.set(0, 1, 2);
    this.scene.add(windowLight, windowLight.target);

    // 吸顶灯阵：物理光照单位下需要高 candela 值（旧值 0.5 太暗是画面发黑的主因）
    for (const x of [-8, -4, 0, 4, 8]) {
      for (const z of [-3.5, 3.5]) {
        const lamp = new THREE.PointLight('#eaf6ff', 9, 13, 2);
        lamp.position.set(x, 4.55, z);
        this.scene.add(lamp);
        const bulb = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.1, 0.6),
          new THREE.MeshBasicMaterial({ color: '#ffffff' })
        );
        bulb.position.set(x, 4.9, z);
        this.scene.add(bulb);
        const hood = new THREE.Mesh(
          new THREE.BoxGeometry(1.75, 0.14, 0.75),
          new THREE.MeshStandardMaterial({ color: '#4a5a70', roughness: 0.5, metalness: 0.4 })
        );
        hood.position.set(x, 4.98, z);
        this.scene.add(hood);
      }
    }

    // 核心暖光：随启动变亮（setPuzzle 调节强度）
    this.coreLight = new THREE.PointLight('#ff922b', 4, 10, 2);
    this.coreLight.position.set(-6.5, 2.2, -5.5);
    this.scene.add(this.coreLight);
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

    // 天花板：提亮色调（旧色在新光照下仍偏死黑）
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: '#46587a', roughness: 0.92 })
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

    // 观察窗（北墙）：程序化窗外远景（§57）
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.6),
      new THREE.MeshBasicMaterial({ map: windowView() })
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
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: buildBubble('我需要一把椅子！'), depthTest: false }));
    bubble.scale.set(2.6, 0.82, 1);
    bubble.position.y = 2.4;
    g.add(bubble);
    this.npc.bubble = bubble;
    this.npcState = null;

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

    // 三按钮（设计书 §24：地面 / 墙面 / 高处）
    this.buttonMeshes = BUTTONS.map((b, idx) => {
      const g = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: '#55677d', roughness: 0.45, metalness: 0.55 });
      const lampMat = new THREE.MeshStandardMaterial({
        color: '#e85d75', emissive: '#e85d75', emissiveIntensity: 0.8, roughness: 0.35,
      });
      let lamp;
      if (b.id === 'ground') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.14, 22), metal);
        base.position.y = 0.07;
        lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 22), lampMat);
        lamp.position.y = 0.17;
        g.add(base, lamp);
      } else if (b.id === 'wall') {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.12), metal);
        lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), lampMat);
        lamp.position.z = 0.16;
        g.add(plate, lamp);
      } else {
        // 高处按钮：墙上托架 + 悬空圆盘（需叠箱/弹簧/缩放才能按到）
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), metal);
        bracket.rotation.x = -0.5;
        bracket.position.y = -0.3;
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.12, 22), metal);
        lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 22), lampMat);
        lamp.position.y = 0.1;
        g.add(bracket, plate, lamp);
      }
      g.position.set(...b.p);
      if (b.id === 'wall') g.rotation.y = Math.PI; // 面向场内（北墙）
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(g);
      return { group: g, lamp, idx, pressed: false };
    });

    // 核心可站立基座
    this.world.addBody(new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(0.9, 1.1, 1.1, 14),
      position: new CANNON.Vec3(CORE_POS[0], 0.55, CORE_POS[2]),
    }));
  }

  /* ---------------- 三级装饰：小物件 / 动画道具 / 巡逻机器人（§45 §54） ---------------- */

  _buildProps() {
    const add = (mesh, x, y, z, ry = 0) => {
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const plastic = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const glassMat = () => new THREE.MeshStandardMaterial({
      color: '#bde0fe', roughness: 0.1, transparent: true, opacity: 0.45,
    });

    /* --- 控制台组（带发光屏幕，程序绘制） --- */
    const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.95, 1.0), plastic('#4d7cfe'));
    consoleBody.material.color.set('#3d6ae0');
    add(consoleBody, 0, 0.48, -7.0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 1.06), plastic('#8fa3b8')), 0, 0.98, -7.0);
    this.screens = [];
    for (const sx of [-1.0, 0, 1.0]) {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 72;
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.5),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      screen.position.set(sx, 1.45, -6.75);
      screen.rotation.x = -0.42;
      this.scene.add(screen);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.6, 0.06), plastic('#22303f'));
      frame.position.set(sx, 1.45, -6.79);
      frame.rotation.x = -0.42;
      this.scene.add(frame);
      this.screens.push({ cv, tex });
    }
    // 控制台 LED 阵列
    this.leds = [];
    const ledColors = ['#51cf66', '#ffd43b', '#ff6b6b', '#4dabf7'];
    for (let i = 0; i < 10; i++) {
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 6),
        new THREE.MeshBasicMaterial({ color: ledColors[i % ledColors.length] })
      );
      led.position.set(-1.55 + i * 0.34, 1.06, -6.6);
      this.scene.add(led);
      this.leds.push({ mesh: led, phase: Math.random() * 6.28 });
    }

    /* --- 储物柜排（南墙，侧室旁） --- */
    const lockerMat = plastic('#7b8ba1');
    for (let i = 0; i < 4; i++) {
      const locker = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.0, 0.5), lockerMat);
      body.position.y = 1.0;
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.02), plastic('#5b6b81'));
      seam.position.set(0, 1.0, 0.26);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), plastic('#ffd43b'));
      handle.position.set(0.18, 1.1, 0.27);
      locker.add(body, seam, handle);
      locker.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      add(locker, 7.0 + (i % 2) * 0.78, 0, 7.55 + Math.floor(i / 2) * 0.0);
      locker.position.y = 0;
    }

    /* --- 推车 / 灭火器 / 垃圾桶 --- */
    const cart = new THREE.Group();
    const cartTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.6), plastic('#ffb703'));
    cartTop.position.y = 0.62;
    cart.add(cartTop);
    for (const [dx, dz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), plastic('#8fa3b8'));
      leg.position.set(dx, 0.3, dz);
      cart.add(leg);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), plastic('#22303f'));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, 0.07, dz);
      cart.add(wheel);
    }
    cart.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    add(cart, -5.5, 0, 2.5, 0.6);

    const extinguisher = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.55, 12), plastic('#e03131'));
    tank.position.y = 0.4;
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), plastic('#22303f'));
    nozzle.position.y = 0.72;
    extinguisher.add(tank, nozzle);
    extinguisher.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    add(extinguisher, 8.9, 0, -6.8);

    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.6, 14), plastic('#5c7a8c'));
    add(bin, -9.0, 0.3, 6.8);

    /* --- 工作台小件（§45 密度） --- */
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.32), plastic('#f8f9fa'));
    add(paper, 2.9, 1.02, -6.9, 0.5);
    const paper2 = paper.clone();
    add(paper2, 3.2, 1.04, -6.7, -0.3);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), plastic('#ff6b6b'));
    add(mug, 1.9, 1.07, -6.6);
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), plastic('#8fa3b8'));
    const hammerHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), plastic('#c98d4b'));
    hammerHandle.rotation.z = Math.PI / 2;
    const hammer = new THREE.Group();
    hammerHead.position.x = 0.14;
    hammer.add(hammerHead, hammerHandle);
    hammer.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    add(hammer, -3.2, 1.0, -6.2, 0.9);
    for (let i = 0; i < 3; i++) {
      const battery = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), plastic(i === 1 ? '#ffd43b' : '#51cf66'));
      battery.rotation.x = Math.PI / 2;
      add(battery, 6.6 + i * 0.1, 0.05, 3.0 + (i % 2) * 0.12, i * 0.7);
    }

    /* --- 地面细节（§42）：压力板黑黄环、排水沟、电缆槽 --- */
    const warn = new THREE.MeshStandardMaterial({ color: '#f59f00', roughness: 0.7 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.18), i % 2 ? warn : plastic('#22303f'));
      seg.position.set(Math.cos(a) * 1.3, 0.015, 6 + Math.sin(a) * 1.3);
      seg.rotation.y = -a;
      this.scene.add(seg);
    }
    // 排水沟（北墙沿线格栅）
    const grate = plastic('#3d4a5c');
    for (let i = 0; i < 26; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.07), grate);
      bar.position.set(-8.5 + i * 0.68, 0.012, -7.55);
      this.scene.add(bar);
    }
    // 电缆槽（控制台 → 核心）
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 7.6), plastic('#2f3d52'));
    duct.position.set(-3.4, 0.025, -4.4);
    duct.rotation.y = -0.62;
    this.scene.add(duct);

    /* --- 墙面细节（§41）：腰线、检修板、窗框与远景 --- */
    const belt = new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.65 });
    const beltN = new THREE.Mesh(new THREE.BoxGeometry(19.2, 0.16, 0.04), belt);
    beltN.position.set(0, 1.15, -7.77);
    this.scene.add(beltN);
    const beltW = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 15.2), belt);
    beltW.position.set(-9.77, 1.15, 0);
    this.scene.add(beltW);
    const panel = plastic('#b9c4d1');
    for (const [px, pz, ry] of [[-5, -7.76, 0], [3.4, -7.76, 0], [-9.76, -3, Math.PI / 2]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), panel);
      p.position.set(px, 2.2, pz);
      p.rotation.y = ry;
      this.scene.add(p);
      for (const [ox, oy] of [[-0.38, 0.28], [0.38, 0.28], [-0.38, -0.28], [0.38, -0.28]]) {
        const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), plastic('#5b6b81'));
        bolt.position.set(px + (ry ? 0 : ox), 2.2 + oy, pz + (ry ? ox : 0));
        this.scene.add(bolt);
      }
    }
    // 窗框十字 + 窗外远景剪影（§57）
    const frameMat = plastic('#22303f');
    const winBarV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.05), frameMat);
    winBarV.position.set(0, 2.6, -7.74);
    this.scene.add(winBarV);
    const winBarH = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.05), frameMat);
    winBarH.position.set(0, 2.6, -7.74);
    this.scene.add(winBarH);
    const silh = new THREE.MeshBasicMaterial({ color: '#4a6a8f' });
    for (const [sx, sw, sh] of [[-2.4, 1.4, 0.9], [-0.4, 2.0, 1.3], [1.8, 1.1, 0.7]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), silh);
      s.position.set(sx, 1.9 + sh / 2, -7.95);
      this.scene.add(s);
    }

    /* --- 天花板（§43）：横梁 / 通风管 / 吊线 --- */
    const beamMat = new THREE.MeshStandardMaterial({ color: '#3d4a5c', roughness: 0.5, metalness: 0.5 });
    for (const bz of [-5, 0, 5]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(19.4, 0.24, 0.3), beamMat);
      beam.position.set(0, 4.78, bz);
      beam.castShadow = true;
      this.scene.add(beam);
    }
    const ductMat = new THREE.MeshStandardMaterial({ color: '#8fa3b8', roughness: 0.4, metalness: 0.55 });
    const ductMain = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 14), ductMat);
    ductMain.rotation.z = Math.PI / 2;
    ductMain.position.set(-1, 4.45, -6.5);
    this.scene.add(ductMain);
    for (const dx of [-6, 4]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 14), plastic('#5b6b81'));
      collar.rotation.z = Math.PI / 2;
      collar.position.set(dx, 4.45, -6.5);
      this.scene.add(collar);
    }
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.5, 12), ductMat);
    drop.position.set(7.6, 3.3, -7.2); // 蒸汽排气口
    this.scene.add(drop);
    // 吊灯垂线
    for (const x of [-6, 0, 6]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), plastic('#22303f'));
      cord.position.set(x, 4.78, 0);
      this.scene.add(cord);
    }

    /* --- 排气蒸汽（§55） --- */
    this.steams = [];
    const steamMat = () => new THREE.SpriteMaterial({
      color: '#e9ecef', transparent: true, opacity: 0.4, depthWrite: false,
    });
    const steamCv = document.createElement('canvas');
    steamCv.width = steamCv.height = 64;
    const sg = steamCv.getContext('2d');
    const grad = sg.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    const steamTex = new THREE.CanvasTexture(steamCv);
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: steamTex, transparent: true, opacity: 0.0, depthWrite: false,
      }));
      sp.scale.setScalar(0.5);
      sp.userData = { base: [7.6, 3.2, -7.2], offset: i / 3 };
      this.scene.add(sp);
      this.steams.push(sp);
    }

    /* --- 巡逻小机器人（§54 环境动画） --- */
    const robot = new THREE.Group();
    const rBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.18, 6, 12), plastic('#8fa3b8'));
    rBody.position.y = 0.34;
    const rEye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#4dabf7' }));
    rEye.position.set(0, 0.46, 0.13);
    const rAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), plastic('#ffd43b'));
    rAntenna.position.y = 0.64;
    const rBase = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.1, 12), plastic('#22303f'));
    rBase.position.y = 0.06;
    robot.add(rBody, rEye, rAntenna, rBase);
    robot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(robot);
    this.robot = {
      group: robot,
      path: [[-3.5, -3.5], [3.5, -3.5], [3.5, 2.5], [-3.5, 2.5]],
      seg: 0, t: 0, speed: 0.055,
      eye: rEye,
    };
  }

  /* ---------------- 动态物体 ---------------- */

  spawnObjects(defs) {
    for (const d of this.dynamics.values()) {
      this.scene.remove(d.mesh);
      this.world.removeBody(d.body);
    }
    this.dynamics.clear();
    for (const def of defs) this.spawnObject(def);
  }

  // 单体生成（开局 / 复制体 / 鸡 / 香蕉通用）
  spawnObject(def) {
    if (this.dynamics.has(def.id)) return;
    const scale = def.scale ?? 1;
    const mesh = buildObjectMesh(def, def.form);
    mesh.position.set(...def.p);
    mesh.scale.setScalar(scale);
    this.scene.add(mesh);
    const body = this._makeBody(
      { ...def, size: def.size.map((s) => s * scale) },
      def.form, def.tags, def.p, def.q
    );
    this.dynamics.set(def.id, {
      def, form: def.form, scale, tags: [...def.tags], mesh, body,
      sim: null, target: null, removed: false,
    });
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
    const sc = def.scale ?? 1;
    const body = new CANNON.Body({
      mass: staticTag ? 0 : FORM_MASS(tags) * sc * sc * sc,
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

  // 标签 / 缩放变化后的物理体重建（视觉 mesh 另行更新）
  _rebuild(d) {
    const pos = d.body.position;
    const quat = d.body.quaternion;
    this.world.removeBody(d.body);
    const sc = d.scale ?? 1;
    d.body = this._makeBody(
      { ...d.def, size: d.def.size.map((s) => s * sc), form: d.form, scale: sc },
      d.form, d.tags,
      [pos.x, pos.y, pos.z],
      [quat.x, quat.y, quat.z, quat.w]
    );
    if (d.sim !== this.myId) d.body.type = CANNON.Body.KINEMATIC;
    else d.body.allowSleep = !d.heldBy;
    d.body.velocity.set(0, 0, 0);
    return d.body;
  }

  applyTag(id, form, tags) {
    const d = this.dynamics.get(id);
    if (!d || d.removed) return;
    d.form = form;
    d.tags = [...tags];
    d.def = { ...d.def, form };
    this.scene.remove(d.mesh);
    d.mesh = buildObjectMesh(d.def, form);
    d.mesh.position.copy(d.body.position);
    d.mesh.quaternion.copy(d.body.quaternion);
    d.mesh.scale.setScalar(d.scale ?? 1);
    this.scene.add(d.mesh);
    this._rebuild(d);
  }

  applyScale(id, scale) {
    const d = this.dynamics.get(id);
    if (!d || d.removed) return;
    const old = d.scale ?? 1;
    // 保持底面贴地
    const bottom = d.body.position.y - (d.def.size[1] * old) / 2;
    d.scale = scale;
    d.mesh.scale.setScalar(scale);
    this._rebuild(d);
    d.body.position.y = bottom + (d.def.size[1] * scale) / 2;
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

  /* ---------------- NPC 快照应用 ---------------- */

  setNpc(s) {
    if (!s || !this.npc) return;
    const prev = this.npcState;
    this.npcState = s;
    if (s.line && (!prev || prev.line !== s.line)) {
      const tex = buildBubble(s.line);
      const old = this.npc.bubble.material.map;
      this.npc.bubble.material.map = tex;
      this.npc.bubble.material.needsUpdate = true;
      if (old) old.dispose();
      this.npc.bubble.visible = true;
    } else if (!s.line && prev && prev.line) {
      this.npc.bubble.visible = false;
    }
  }

  /* ---------------- 门 / 谜题视觉 ---------------- */

  setPuzzle(puzzle) {
    this.doors.exit && (this.doors.exit.open = puzzle.exitOpen);
    this.doors.side && (this.doors.side.open = puzzle.sideDoorOpen);

    if (this.npc) {
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
      if (this.coreLight) {
        this.coreLight.intensity = on ? 16 : 4;
        this.coreLight.color.set(on ? '#38d9a9' : '#ff922b');
      }
    }
    if (this.exitSign) {
      this.exitSign.material.color.set(puzzle.exitOpen ? '#51cf66' : '#ff6b6b');
    }
    if (this.plateMesh) {
      this.plateMesh.material.color.set(puzzle.sideDoorOpen ? '#51cf66' : '#e85d75');
      this.plateMesh.material.emissive.set(puzzle.sideDoorOpen ? '#51cf66' : '#e85d75');
    }
    if (this.buttonMeshes && puzzle.buttons) {
      this.buttonMeshes.forEach((bm, i) => {
        bm.pressed = !!puzzle.buttons[i];
        const color = bm.pressed ? '#51cf66' : '#e85d75';
        bm.lamp.material.color.set(color);
        bm.lamp.material.emissive.set(color);
      });
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
      r.group.scale.setScalar(p.giant ? 2 : 1); // 巨型玩家事件（设计书 §25）
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

  // 物体暴走事件：由模拟者给自己的动态物体施加随机冲量
  rampage() {
    for (const d of this.dynamics.values()) {
      if (d.removed || d.sim !== this.myId || d.body.type !== CANNON.Body.DYNAMIC) continue;
      d.body.velocity.set((Math.random() - 0.5) * 9, 1 + Math.random() * 4, (Math.random() - 0.5) * 9);
      d.body.angularVelocity.set(Math.random() * 7, Math.random() * 7, Math.random() * 7);
    }
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

    // NPC：坐下动画 + 位置/朝向跟随服务器 AI + 台词气泡
    if (this.npc) {
      const g = this.npc.group;
      g.position.y += (this.npc.seatY - g.position.y) * Math.min(1, dt * 4);
      const s = this.npcState;
      if (s) {
        const k = Math.min(1, dt * 6);
        g.position.x += (s.x - g.position.x) * k;
        g.position.z += (s.z - g.position.z) * k;
        let dy = s.yaw - g.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        g.rotation.y += dy * k;
        if (s.scared) {
          // 被鸡吓到：原地蹦跳
          g.position.y = this.npc.seatY + Math.abs(Math.sin(performance.now() / 85)) * 0.09;
          g.rotation.z = Math.sin(performance.now() / 60) * 0.12;
        } else {
          g.rotation.z += (0 - g.rotation.z) * k;
        }
      }
    }

    // 风扇
    if (this.fan) this.fan.rotation.y += dt * 2.2;

    // 三按钮指示灯：未按红灯脉动，按下绿灯常亮
    if (this.buttonMeshes) {
      const pulse = 0.7 + Math.sin(performance.now() / 380) * 0.35;
      for (const bm of this.buttonMeshes) {
        bm.lamp.material.emissiveIntensity = bm.pressed ? 1.8 : pulse;
      }
    }

    /* ---- 环境动画（设计书 §54：让实验室看起来正在运行） ---- */
    const nowMs = performance.now();

    // 控制台屏幕：每 0.45s 重绘波形与字符
    if (this.screens && nowMs - (this._screenT || 0) > 450) {
      this._screenT = nowMs;
      const chaosTxt = this.chaosValue ?? 0;
      for (let si = 0; si < this.screens.length; si++) {
        const s = this.screens[si];
        const g = s.cv.getContext('2d');
        g.fillStyle = '#06263f';
        g.fillRect(0, 0, 128, 72);
        g.strokeStyle = si === 1 ? '#51cf66' : '#4dabf7';
        g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= 128; x += 4) {
          const y = 40 + Math.sin((x + nowMs / 50 + si * 40) / 11) * (10 + Math.random() * 8);
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.font = '10px monospace';
        g.fillStyle = '#51cf66';
        g.fillText('MUL-OS v0.3', 5, 12);
        g.fillStyle = '#ffd43b';
        g.fillText(`CHAOS ${chaosTxt}%`, 5, 66);
        s.tex.needsUpdate = true;
      }
    }

    // LED 阵列：相位闪烁
    if (this.leds) {
      for (const l of this.leds) l.mesh.visible = Math.sin(nowMs / 260 + l.phase) > -0.3;
    }

    // 排气蒸汽：上升扩散循环
    if (this.steams) {
      for (const sp of this.steams) {
        const u = ((nowMs / 4200) + sp.userData.offset) % 1;
        const [bx, by, bz] = sp.userData.base;
        sp.position.set(bx + Math.sin(u * 7) * 0.18, by + u * 1.6, bz);
        sp.scale.setScalar(0.35 + u * 0.95);
        sp.material.opacity = 0.4 * Math.sin(u * Math.PI);
      }
    }

    // 巡逻小机器人：沿矩形路径走动 + 浮动 + 眼睛扫色
    if (this.robot) {
      const r = this.robot;
      r.t += dt * 0.17;
      while (r.t >= 1) { r.t -= 1; r.seg = (r.seg + 1) % r.path.length; }
      const a = r.path[r.seg];
      const b = r.path[(r.seg + 1) % r.path.length];
      const rx = a[0] + (b[0] - a[0]) * r.t;
      const rz = a[1] + (b[1] - a[1]) * r.t;
      r.group.position.set(rx, Math.abs(Math.sin(nowMs / 170)) * 0.035, rz);
      const targetYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      let rdy = targetYaw - r.group.rotation.y;
      while (rdy > Math.PI) rdy -= Math.PI * 2;
      while (rdy < -Math.PI) rdy += Math.PI * 2;
      r.group.rotation.y += rdy * 0.12;
      r.eye.material.color.setHSL((nowMs / 3000) % 1, 0.85, 0.62);
    }

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
      // 行走摆动：趋近目标的差距近似瞬时速度
      const sp = r.targetPos ? r.pos.distanceTo(r.targetPos) * 10 : 0;
      animateAvatar(r.group, sp, nowMs / 1000);
    }

    // 鸡的自主跑动（由模拟者执行，撞到谁全靠物理）
    for (const d of this.dynamics.values()) {
      if (d.removed || d.def.kind !== 'chicken' || d.sim !== this.myId || d.heldBy) continue;
      const t = performance.now();
      if (!d.aiDir || t - (d.aiT || 0) > 900 + ((d.body.id * 137) % 800)) {
        d.aiT = t;
        const a = Math.random() * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        // 贴墙时强制朝场内，避免顶着墙跑
        d.aiDir = [
          Math.abs(d.body.position.x) > 8.4 ? -Math.sign(d.body.position.x) * 0.8 : dx,
          Math.abs(d.body.position.z) > 6.4 ? -Math.sign(d.body.position.z) * 0.8 : dz,
        ];
      }
      d.body.velocity.x = d.aiDir[0] * 4.6;
      d.body.velocity.z = d.aiDir[1] * 4.6;
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
