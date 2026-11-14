export type ItemKind =
  | 'tissue'
  | 'pen'
  | 'mug'
  | 'kettle'
  | 'mouse'
  | 'ink'
  | 'phone'
  | 'keyboard'
  | 'lipstick'
  | 'compact'
  | 'perfume'
  | 'mirror'
  | 'remote'
  | 'wineglass'
  | 'fishbowl';

export interface ItemSpec {
  readonly kind: ItemKind;
  readonly label: string;
  readonly baseScore: number;
  readonly density: number;
  readonly friction: number;
  readonly frictionStatic: number;
  readonly frictionAir: number;
  readonly restitution: number;
  /** 推动时每秒增加的基础噪声 */
  readonly pushNoisePerSec: number;
  /** 落地碎裂/巨响增加的噪声 */
  readonly dropNoise: number;
  /** 基于质量的速度引导微推力上限 */
  readonly maxNudgeSpeed: number;
  readonly width: number;
  readonly height: number;
  readonly heavy?: boolean;
  /** 易碎高重心物品（在桌上提前倾倒只能拿一半折损分） */
  readonly fragileOnTable?: boolean;
  /** 来电震动自滑物品 */
  readonly selfBuzz?: boolean;
}

export const tuning = {
  view: {
    width: 390,
    height: 640,
  },
  loop: {
    fixedDtMs: 1000 / 60,
    maxFrameDtMs: 50,
  },
  scene: {
    tableTopY: 420,
    tableLeftX: 0,
    tableEdgeX: 296,
    tableThickness: 24,
    /** 桌沿下方 180px 地板碰撞线 */
    floorY: 600,
    leftWallX: 10,
  },
  cat: {
    startX: 54,
    minX: 34,
    maxX: 276,
    bodyHalfW: 22,
    moveSpeed: 155,
    /** 松手后 0.12s 秒切眯眼装睡 */
    napTransitionSec: 0.12,
    pawReach: 28,
    tapCooldownSec: 0.35,
    tapImpulseSpeedBoost: 84,
    tapNoiseSpike: 24,
  },
  buttons: {
    tap: { x: 332, y: 566, r: 34 },
  },
  teeter: {
    /** 质心距离桌沿在此范围内且倾角大于 minTiltDeg 即触发悬边 */
    edgeMarginPx: 26,
    minTiltDeg: 6,
    tier2HoldSec: 1.5,
  },
  steward: {
    roundDurationSec: 60,
    maxHearts: 3,
    warningDurationSec: 0.9,
    watchMinSec: 1.8,
    watchMaxSec: 2.5,
    teeterWatchBonusSec: 0.6,
    teeterRelaxedPenaltySec: 0.45,
    caughtPauseSec: 1.25,
    baseRelaxedSec: 4.4,
    minRelaxedSec: 1.4,
    noiseDecayPerSec: 9,
    motionSpeedThreshold: 0.35,
    distractMinCooldownSec: 14,
    distractMaxCooldownSec: 18,
    distractDurationSec: 2.6,
  },
  items: {
    tissue: {
      kind: 'tissue',
      label: '纸巾团',
      baseScore: 10,
      density: 0.0005,
      friction: 0.18,
      frictionStatic: 0.25,
      frictionAir: 0.015,
      restitution: 0.15,
      pushNoisePerSec: 1,
      dropNoise: 2,
      maxNudgeSpeed: 2.6,
      width: 28,
      height: 20,
    },
    pen: {
      kind: 'pen',
      label: '圆珠笔',
      baseScore: 30,
      density: 0.0012,
      friction: 0.03,
      frictionStatic: 0.06,
      frictionAir: 0.003,
      restitution: 0.2,
      pushNoisePerSec: 4,
      dropNoise: 10,
      maxNudgeSpeed: 3.1,
      width: 14,
      height: 14,
    },
    mug: {
      kind: 'mug',
      label: '陶瓷马克杯',
      baseScore: 80,
      density: 0.0042,
      friction: 0.48,
      frictionStatic: 0.68,
      frictionAir: 0.012,
      restitution: 0.05,
      pushNoisePerSec: 18,
      dropNoise: 38,
      maxNudgeSpeed: 1.35,
      width: 34,
      height: 38,
      heavy: true,
    },
    kettle: {
      kind: 'kettle',
      label: '电水壶',
      baseScore: 300,
      density: 0.018,
      friction: 0.78,
      frictionStatic: 1.15,
      frictionAir: 0.02,
      restitution: 0.02,
      pushNoisePerSec: 36,
      dropNoise: 58,
      maxNudgeSpeed: 0.38,
      width: 52,
      height: 62,
      heavy: true,
    },
    mouse: {
      kind: 'mouse',
      label: '圆滑鼠标',
      baseScore: 60,
      density: 0.0014,
      friction: 0.02,
      frictionStatic: 0.04,
      frictionAir: 0.002,
      restitution: 0.22,
      pushNoisePerSec: 6,
      dropNoise: 18,
      maxNudgeSpeed: 3.3,
      width: 32,
      height: 18,
    },
    ink: {
      kind: 'ink',
      label: '老式墨水瓶',
      baseScore: 120,
      density: 0.0045,
      friction: 0.44,
      frictionStatic: 0.62,
      frictionAir: 0.012,
      restitution: 0.05,
      pushNoisePerSec: 16,
      dropNoise: 68,
      maxNudgeSpeed: 1.25,
      width: 28,
      height: 34,
      heavy: true,
    },
    phone: {
      kind: 'phone',
      label: '来电手机',
      baseScore: 180,
      density: 0.0038,
      friction: 0.3,
      frictionStatic: 0.42,
      frictionAir: 0.01,
      restitution: 0.08,
      pushNoisePerSec: 14,
      dropNoise: 42,
      maxNudgeSpeed: 1.45,
      width: 36,
      height: 14,
      selfBuzz: true,
    },
    keyboard: {
      kind: 'keyboard',
      label: '机械键盘',
      baseScore: 280,
      density: 0.02,
      friction: 0.8,
      frictionStatic: 1.2,
      frictionAir: 0.02,
      restitution: 0.02,
      pushNoisePerSec: 34,
      dropNoise: 60,
      maxNudgeSpeed: 0.34,
      width: 68,
      height: 20,
      heavy: true,
    },
    lipstick: {
      kind: 'lipstick',
      label: '圆柱口红',
      baseScore: 70,
      density: 0.0011,
      friction: 0.03,
      frictionStatic: 0.05,
      frictionAir: 0.003,
      restitution: 0.25,
      pushNoisePerSec: 5,
      dropNoise: 14,
      maxNudgeSpeed: 3.0,
      width: 14,
      height: 14,
    },
    compact: {
      kind: 'compact',
      label: '粉饼盒',
      baseScore: 110,
      density: 0.0032,
      friction: 0.38,
      frictionStatic: 0.52,
      frictionAir: 0.012,
      restitution: 0.06,
      pushNoisePerSec: 12,
      dropNoise: 32,
      maxNudgeSpeed: 1.55,
      width: 34,
      height: 16,
    },
    perfume: {
      kind: 'perfume',
      label: '天价香水瓶',
      baseScore: 220,
      density: 0.0034,
      friction: 0.36,
      frictionStatic: 0.5,
      frictionAir: 0.01,
      restitution: 0.05,
      pushNoisePerSec: 18,
      dropNoise: 52,
      maxNudgeSpeed: 1.2,
      width: 24,
      height: 46,
      fragileOnTable: true,
    },
    mirror: {
      kind: 'mirror',
      label: '桌面化妆镜',
      baseScore: 320,
      density: 0.022,
      friction: 0.82,
      frictionStatic: 1.25,
      frictionAir: 0.02,
      restitution: 0.02,
      pushNoisePerSec: 36,
      dropNoise: 64,
      maxNudgeSpeed: 0.3,
      width: 44,
      height: 60,
      heavy: true,
    },
    remote: {
      kind: 'remote',
      label: '电视遥控器',
      baseScore: 90,
      density: 0.0022,
      friction: 0.28,
      frictionStatic: 0.4,
      frictionAir: 0.01,
      restitution: 0.08,
      pushNoisePerSec: 10,
      dropNoise: 24,
      maxNudgeSpeed: 1.8,
      width: 46,
      height: 14,
    },
    wineglass: {
      kind: 'wineglass',
      label: '高脚红酒杯',
      baseScore: 260,
      density: 0.0028,
      friction: 0.32,
      frictionStatic: 0.44,
      frictionAir: 0.009,
      restitution: 0.05,
      pushNoisePerSec: 18,
      dropNoise: 56,
      maxNudgeSpeed: 1.15,
      width: 22,
      height: 52,
      fragileOnTable: true,
    },
    fishbowl: {
      kind: 'fishbowl',
      label: '金鱼圆形鱼缸',
      baseScore: 500,
      density: 0.028,
      friction: 0.86,
      frictionStatic: 1.35,
      frictionAir: 0.022,
      restitution: 0.02,
      pushNoisePerSec: 42,
      dropNoise: 75,
      maxNudgeSpeed: 0.24,
      width: 58,
      height: 54,
      heavy: true,
    },
  } as Record<ItemKind, ItemSpec>,
} as const;

export type Tuning = typeof tuning;
