// 共享关卡数据（第一张地图：荒谬实验室 · Prototype 布局）
// 服务端持有权威副本用于规则校验；客户端在 roundStart 中接收后构建场景。

export const ROOM = { minX: -10, maxX: 10, minZ: -8, maxZ: 8, height: 5, wall: 0.4 };

export const SPAWNS = [
  [-8.5, 1.0, 5.5],
  [-7.0, 1.0, 5.5],
  [-8.5, 1.0, 7.0],
  [-7.0, 1.0, 7.0],
];

// 出口触发区（东墙门洞内侧）
export const EXIT = { x0: 9.0, x1: 10.0, z0: -1.6, z1: 1.6 };

// 中央压力板（踩住开启侧室门）
export const PLATE1 = { id: 'plate1', x0: -0.9, x1: 0.9, z0: 5.1, z1: 6.9 };

// 侧室（内隔间）：门在 z=6 面向主厅，内有预制椅子与箱子
export const SIDE_ROOM = { x0: 2, x1: 6, z0: 6, z1: 8, doorX: 4, doorZ: 6 };

export const NPC = { pos: [7.2, 0, 0], look: -Math.PI / 2 }; // 疯狂实验员，面向西侧
export const NPC_HOME = { x: 7.2, z: 0 };                   // NPC 活动中心（躲鸡时的范围约束）
// 疯狂实验员台词池（设计书 §26：不靠谱、说废话、偶尔说错、会反应）
export const NPC_LINES = {
  waiting: [
    '我需要一把椅子！',
    '把箱子改成椅子就行，标签枪会搞定的。',
    '侧室里有把现成的椅子……先压住压力板。',
    '高台上的能源球，我够不着。',
  ],
  idle: [
    '鸡又来了？这不是实验步骤。',
    '我当年也是个冒险家，直到膝盖中了鸡。',
    '核心在西北角，别把鸡插进去。',
    '低重力的时候别往天花板上跳！',
    '那台机器还在转，说明它还没坏——大概。',
    '标签枪也给我玩玩……算了，我会把实验室烧了。',
  ],
  done: [
    '很好！虽然我不知道你是怎么做到的。',
    '椅子不错，出口在东边。',
    '别急着走，我还想看混乱值能冲多高。',
  ],
};
export const CORE_POS = [-6.5, 0, -5.5];                     // 核心插槽
export const PLATFORM = { x0: -9, x1: -6, z0: -7.5, z1: -4.5, h: 3 }; // 能源球高台
export const ORB_HOME = [-7.5, 3.35, -6];                    // 能源球初始位置（高台顶）

// 可同步动态物体定义
export const OBJECTS = [
  { id: 'box1', form: 'BOX', tags: ['WOOD', 'HEAVY', 'MOVABLE', 'PHYSICAL'], size: [0.8, 0.8, 0.8], p: [0, 0.4, 0] },
  { id: 'box2', form: 'BOX', tags: ['WOOD', 'HEAVY', 'MOVABLE', 'PHYSICAL'], size: [0.8, 0.8, 0.8], p: [-2, 0.4, 1.6] },
  { id: 'box3', form: 'BOX', tags: ['WOOD', 'HEAVY', 'MOVABLE', 'PHYSICAL'], size: [0.8, 0.8, 0.8], p: [3.2, 0.4, -3] },
  { id: 'box4', form: 'BOX', tags: ['WOOD', 'HEAVY', 'MOVABLE', 'PHYSICAL'], size: [0.8, 0.8, 0.8], p: [-4, 0.4, 4] },
  { id: 'chair0', form: 'CHAIR', tags: ['WOOD', 'LIGHT', 'MOVABLE', 'PHYSICAL'], size: [0.55, 1.0, 0.55], p: [4.6, 0.5, 7.2] },
  { id: 'box5', form: 'BOX', tags: ['WOOD', 'HEAVY', 'MOVABLE', 'PHYSICAL'], size: [0.8, 0.8, 0.8], p: [3.2, 0.4, 7.2] },
  { id: 'orb', form: 'ORB', tags: ['GLOW', 'LIGHT', 'MOVABLE', 'PHYSICAL'], size: [0.4, 0.4, 0.4], p: [...ORB_HOME], key: true },
];

// 标签规则：form 可被标签枪直接改写；属性对双向翻转
export const TAG_RULES = {
  forms: ['BOX', 'CHAIR', 'SPRING', 'LAMP'],
  pairs: { HEAVY: 'LIGHT', LIGHT: 'HEAVY', MOVABLE: 'STATIC', STATIC: 'MOVABLE' },
};

// 能力参数（设计书 §15）
export const ABILITIES = {
  tagGun: { cooldownMs: 10_000, range: 6 },
  scaleGun: { cooldownMs: 6_000, range: 6 },
  copyGun: { cooldownMs: 20_000, range: 6, lifetimeMs: 30_000 },
  morph: { cooldownMs: 15_000, durationMs: 15_000, range: 999 },
  grabRange: 2.6,
  maxObjects: 14, // 场上动态物体上限（复制/事件共用）
};

// 缩放枪档位（设计书 §14.2）
export const SCALE_LEVELS = [0.6, 1.0, 1.6];

// 随机事件表（设计书 §25）：服务器权威调度，客户端表现
export const RANDOM_EVENTS = {
  chicken: { count: 3, lifetimeMs: 60_000, chaos: 5, text: '🐔 鸡群入侵了实验室！' },
  giant: { durationMs: 10_000, chaos: 0, text: '🔬 有玩家变成了巨型玩家！' },
  lowGravity: { durationMs: 15_000, chaos: 10, text: '🌙 低重力！大家飘起来了！' },
  banana: { count: 2, lifetimeMs: 45_000, chaos: 0, text: '🍌 地上出现了香蕉皮……' },
  rampage: { chaos: 10, text: '💥 物体开始自己暴走！' },
};

// 混乱事件表（设计书 §17）
export const CHAOS_EVENTS = {
  absurdTag: 10,    // 把能源球改成椅子等荒诞转换
  morphSelf: 3,     // 玩家物化
  hardThrow: 3,     // 高速投掷
  bananaSlip: 3,    // 踩香蕉皮
};

export const GOAL_TEXT = '启动实验室出口';
export const QUESTS = [
  { id: 'chair', text: '给疯狂实验员一把椅子' },
  { id: 'orb', text: '取回高台上的能源球' },
  { id: 'core', text: '把能源球插入核心' },
  { id: 'exit', text: '从出口逃离实验室' },
];
