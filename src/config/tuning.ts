export type ItemKind = 'tissue' | 'pen' | 'mug' | 'kettle';

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
    moveSpeed: 155,
    /** 松手后 0.12s 秒切眯眼装睡 */
    napTransitionSec: 0.12,
    pawReach: 26,
    tapCooldownSec: 0.35,
    tapImpulseSpeedBoost: 90,
    tapNoiseSpike: 24,
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
    caughtPauseSec: 1.25,
    baseRelaxedSec: 4.4,
    minRelaxedSec: 1.4,
    noiseDecayPerSec: 9,
    motionSpeedThreshold: 0.35,
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
      density: 0.0038,
      friction: 0.45,
      frictionStatic: 0.62,
      frictionAir: 0.012,
      restitution: 0.05,
      pushNoisePerSec: 18,
      dropNoise: 38,
      maxNudgeSpeed: 1.5,
      width: 34,
      height: 38,
    },
    kettle: {
      kind: 'kettle',
      label: '电水壶',
      baseScore: 300,
      density: 0.0092,
      friction: 0.62,
      frictionStatic: 0.85,
      frictionAir: 0.015,
      restitution: 0.02,
      pushNoisePerSec: 34,
      dropNoise: 55,
      maxNudgeSpeed: 0.78,
      width: 52,
      height: 62,
    },
  } satisfies Record<ItemKind, ItemSpec>,
} as const;

export type Tuning = typeof tuning;
