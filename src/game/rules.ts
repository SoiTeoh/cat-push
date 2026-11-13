import { tuning, type ItemKind, type Tuning } from '../config/tuning';

export type TeeterTier = 'safe' | 'teeter2' | 'teeter3';

export interface TeeterResult {
  readonly tier: TeeterTier;
  readonly multiplier: 1 | 2 | 3;
  readonly holdSec: number;
}

export type StewardPhase = 'RELAXED' | 'WARNING' | 'WATCHING' | 'CAUGHT';

export interface StewardState {
  readonly phase: StewardPhase;
  readonly phaseTimerSec: number;
  readonly relaxedElapsedSec: number;
  readonly noise: number;
  readonly hearts: number;
  readonly remainingSec: number;
  readonly finished: boolean;
  readonly endReason: 'none' | 'hearts_zero' | 'time_up';
}

export interface DropRecord {
  readonly kind: ItemKind;
  readonly multiplier: 1 | 2 | 3;
  readonly score: number;
}

export interface BillSummary {
  readonly totalScore: number;
  readonly counts: Record<ItemKind, number>;
  readonly teeterDrops: number;
  readonly extremeTeeterDrops: number;
  readonly records: readonly DropRecord[];
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/**
 * 悬崖挑衅倍率计算（不依赖 Canvas / Matter DOM）：
 * 质心进入桌沿前 edgeMarginPx 内（或已微悬出）且倾斜角 |θ| > 6° 时进入悬边态；
 * 持续超过 1.5 秒升级为 ×3.0 极限试探。
 */
export function evaluateTeeterState(
  itemX: number,
  angleRad: number,
  tableEdgeX: number,
  prevHoldSec: number,
  dtSec: number,
  alreadyDropped: boolean,
  t: Tuning = tuning,
): TeeterResult {
  if (alreadyDropped) {
    return {
      tier: prevHoldSec >= t.teeter.tier2HoldSec ? 'teeter3' : prevHoldSec > 0 ? 'teeter2' : 'safe',
      multiplier: prevHoldSec >= t.teeter.tier2HoldSec ? 3 : prevHoldSec > 0 ? 2 : 1,
      holdSec: prevHoldSec,
    };
  }

  const absDeg = Math.abs((angleRad * 180) / Math.PI);
  const nearEdge =
    itemX >= tableEdgeX - t.teeter.edgeMarginPx &&
    itemX <= tableEdgeX + t.teeter.edgeMarginPx * 1.4;

  if (!nearEdge || absDeg <= t.teeter.minTiltDeg) {
    return { tier: 'safe', multiplier: 1, holdSec: 0 };
  }

  const holdSec = prevHoldSec + Math.max(0, dtSec);
  if (holdSec >= t.teeter.tier2HoldSec) {
    return { tier: 'teeter3', multiplier: 3, holdSec };
  }
  return { tier: 'teeter2', multiplier: 2, holdSec };
}

export function createStewardState(t: Tuning = tuning): StewardState {
  return {
    phase: 'RELAXED',
    phaseTimerSec: 0,
    relaxedElapsedSec: 0,
    noise: 0,
    hearts: t.steward.maxHearts,
    remainingSec: t.steward.roundDurationSec,
    finished: false,
    endReason: 'none',
  };
}

/** 根据噪声值计算铲屎官从 RELAXED 进入 WARNING 的间隔（噪声越高转头越快）。 */
export function computeRelaxedInterval(noise: number, t: Tuning = tuning): number {
  const ratio = clamp(noise / 100, 0, 1);
  return t.steward.baseRelaxedSec - ratio * (t.steward.baseRelaxedSec - t.steward.minRelaxedSec);
}

export interface StewardStepInput {
  readonly dtSec: number;
  readonly playerActive: boolean;
  readonly hasMovingItem: boolean;
  readonly itemDroppedDuringStep: boolean;
  readonly addedNoise: number;
  /** 0..1 的确定性或随机数，用于决定 WATCHING 持续时长 (1.8s..2.5s) */
  readonly watchRoll?: number;
}

/**
 * 铲屎官警觉状态机：RELAXED -> WARNING (0.9s) -> WATCHING (1.8~2.5s) -> CAUGHT。
 * 在 WATCHING 期间若玩家移动/挥爪，或有物体非静止滚动/当面掉落，立刻抓包扣 1 颗红心。
 */
export function stepSteward(
  state: StewardState,
  input: StewardStepInput,
  t: Tuning = tuning,
): StewardState {
  if (state.finished) return state;

  const dt = Math.max(0, input.dtSec);
  const remainingSec = Math.max(0, state.remainingSec - dt);
  let noise = clamp(
    state.noise + Math.max(0, input.addedNoise) - t.steward.noiseDecayPerSec * dt,
    0,
    100,
  );
  let { phase, phaseTimerSec, relaxedElapsedSec, hearts } = state;

  if (phase === 'RELAXED') {
    relaxedElapsedSec += dt;
    const interval = computeRelaxedInterval(noise, t);
    if (relaxedElapsedSec >= interval) {
      phase = 'WARNING';
      phaseTimerSec = t.steward.warningDurationSec;
      relaxedElapsedSec = 0;
    }
  } else if (phase === 'WARNING') {
    phaseTimerSec -= dt;
    if (phaseTimerSec <= 0) {
      const roll = clamp(input.watchRoll ?? 0.5, 0, 1);
      phase = 'WATCHING';
      phaseTimerSec =
        t.steward.watchMinSec +
        roll * (t.steward.watchMaxSec - t.steward.watchMinSec);
    }
  } else if (phase === 'WATCHING') {
    const caught =
      input.playerActive || input.hasMovingItem || input.itemDroppedDuringStep;
    if (caught) {
      hearts = Math.max(0, hearts - 1);
      phase = 'CAUGHT';
      phaseTimerSec = t.steward.caughtPauseSec;
      noise = clamp(noise * 0.45, 0, 100);
    } else {
      phaseTimerSec -= dt;
      if (phaseTimerSec <= 0) {
        // 成功装乖躲过盯防，警觉值小幅下降
        phase = 'RELAXED';
        phaseTimerSec = 0;
        relaxedElapsedSec = 0;
        noise = clamp(noise - 18, 0, 100);
      }
    }
  } else if (phase === 'CAUGHT') {
    phaseTimerSec -= dt;
    if (phaseTimerSec <= 0) {
      phase = 'RELAXED';
      phaseTimerSec = 0;
      relaxedElapsedSec = 0;
    }
  }

  let finished = false;
  let endReason: StewardState['endReason'] = 'none';
  if (hearts <= 0) {
    finished = true;
    endReason = 'hearts_zero';
  } else if (remainingSec <= 0) {
    finished = true;
    endReason = 'time_up';
  }

  return {
    phase,
    phaseTimerSec,
    relaxedElapsedSec,
    noise,
    hearts,
    remainingSec,
    finished,
    endReason,
  };
}

export function createBillSummary(): BillSummary {
  return {
    totalScore: 0,
    counts: { tissue: 0, pen: 0, mug: 0, kettle: 0 },
    teeterDrops: 0,
    extremeTeeterDrops: 0,
    records: [],
  };
}

export function recordItemDrop(
  bill: BillSummary,
  kind: ItemKind,
  multiplier: 1 | 2 | 3,
  t: Tuning = tuning,
): BillSummary {
  const score = Math.round(t.items[kind].baseScore * multiplier);
  return {
    totalScore: bill.totalScore + score,
    counts: {
      ...bill.counts,
      [kind]: bill.counts[kind] + 1,
    },
    teeterDrops: bill.teeterDrops + (multiplier >= 2 ? 1 : 0),
    extremeTeeterDrops: bill.extremeTeeterDrops + (multiplier === 3 ? 1 : 0),
    records: [...bill.records, { kind, multiplier, score }],
  };
}
