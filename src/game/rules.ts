import type { StageId } from '../config/stages';
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
  readonly distractTimerSec: number;
  readonly distractCooldownSec: number;
  readonly suspiciousTeeter: boolean;
  readonly teeterPenaltyActive: boolean;
  readonly finished: boolean;
  readonly endReason: 'none' | 'hearts_zero' | 'time_up' | 'stage_cleared';
}

export interface DropRecord {
  readonly kind: ItemKind;
  readonly multiplier: 1 | 2 | 3;
  readonly score: number;
  readonly brokeOnTable: boolean;
}

export interface BillSummary {
  readonly totalScore: number;
  readonly counts: Record<ItemKind, number>;
  readonly teeterDrops: number;
  readonly extremeTeeterDrops: number;
  readonly damagedDrops: number;
  readonly records: readonly DropRecord[];
}

export interface StageProgress {
  readonly unlockedStage: StageId;
  readonly stars: Record<StageId, 0 | 1 | 2 | 3>;
  readonly bestScores: Record<StageId, number>;
  readonly endlessBestScore: number;
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

/**
 * 判断高重心易碎物（perfume / wineglass）是否在桌面上提前倾倒碎裂：
 * 若质心尚在安全桌面上（未到桌沿悬边区）而倾角 >= 65°，判定为提前倒碎。
 */
export function isFragileBrokenOnTable(
  kind: ItemKind,
  itemX: number,
  angleRad: number,
  tableEdgeX: number,
  t: Tuning = tuning,
): boolean {
  if (!t.items[kind].fragileOnTable) return false;
  if (itemX >= tableEdgeX - t.teeter.edgeMarginPx) return false;
  const absDeg = Math.abs((angleRad * 180) / Math.PI);
  return absDeg >= 65;
}

export function calculateDropScore(
  kind: ItemKind,
  multiplier: 1 | 2 | 3,
  brokeOnTable: boolean,
  t: Tuning = tuning,
): number {
  const base = t.items[kind].baseScore;
  if (brokeOnTable) {
    return Math.round(base * 0.5);
  }
  return Math.round(base * multiplier);
}

export function createStewardState(t: Tuning = tuning): StewardState {
  return {
    phase: 'RELAXED',
    phaseTimerSec: 0,
    relaxedElapsedSec: 0,
    noise: 0,
    hearts: t.steward.maxHearts,
    remainingSec: t.steward.roundDurationSec,
    distractTimerSec: 0,
    distractCooldownSec: t.steward.distractMinCooldownSec,
    suspiciousTeeter: false,
    teeterPenaltyActive: false,
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
  /** 桌面上是否存在悬边 >= ×2.0 的倾斜物品 */
  readonly hasTeeteringItem?: boolean;
  /** 是否启用“悬边物品引发额外怀疑”（第 2 关起或无尽第 2 波起） */
  readonly enableTeeterSuspicion?: boolean;
  /** 0..1 的确定性或随机数，用于决定 WATCHING 持续时长 (1.8s..2.5s) */
  readonly watchRoll?: number;
  /** 0..1 的确定性或随机数，用于决定下次分心冷却 (14s..18s) */
  readonly distractRoll?: number;
}

/**
 * 铲屎官警觉状态机：RELAXED -> WARNING (0.9s) -> WATCHING (1.8~2.5s) -> CAUGHT。
 * - RELAXED 期间周期性触发“手机/快递分心窗口 (2.6s)”，分心期间屏蔽 WARNING。
 * - 高波次/第2关起：若 WATCHING 时桌沿有悬边物品，盯防延长 +0.6s，下次安全期缩短。
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
  let {
    phase,
    phaseTimerSec,
    relaxedElapsedSec,
    hearts,
    distractTimerSec,
    distractCooldownSec,
    suspiciousTeeter,
    teeterPenaltyActive,
  } = state;

  if (phase === 'RELAXED') {
    if (distractTimerSec > 0) {
      distractTimerSec = Math.max(0, distractTimerSec - dt);
    } else {
      distractCooldownSec -= dt;
      if (distractCooldownSec <= 0) {
        distractTimerSec = t.steward.distractDurationSec;
        const dRoll = clamp(input.distractRoll ?? 0.5, 0, 1);
        distractCooldownSec =
          t.steward.distractMinCooldownSec +
          dRoll * (t.steward.distractMaxCooldownSec - t.steward.distractMinCooldownSec);
      } else {
        relaxedElapsedSec += dt;
        const baseInterval = computeRelaxedInterval(noise, t);
        const interval = teeterPenaltyActive
          ? Math.max(t.steward.minRelaxedSec, baseInterval - t.steward.teeterRelaxedPenaltySec)
          : baseInterval;
        if (relaxedElapsedSec >= interval) {
          phase = 'WARNING';
          phaseTimerSec = t.steward.warningDurationSec;
          relaxedElapsedSec = 0;
        }
      }
    }
  } else if (phase === 'WARNING') {
    distractTimerSec = 0;
    phaseTimerSec -= dt;
    if (phaseTimerSec <= 0) {
      const roll = clamp(input.watchRoll ?? 0.5, 0, 1);
      const teeterSuspicion = Boolean(input.enableTeeterSuspicion && input.hasTeeteringItem);
      phase = 'WATCHING';
      phaseTimerSec =
        t.steward.watchMinSec +
        roll * (t.steward.watchMaxSec - t.steward.watchMinSec) +
        (teeterSuspicion ? t.steward.teeterWatchBonusSec : 0);
      suspiciousTeeter = teeterSuspicion;
      teeterPenaltyActive = teeterSuspicion;
    }
  } else if (phase === 'WATCHING') {
    const caught =
      input.playerActive || input.hasMovingItem || input.itemDroppedDuringStep;
    if (caught) {
      hearts = Math.max(0, hearts - 1);
      phase = 'CAUGHT';
      phaseTimerSec = t.steward.caughtPauseSec;
      suspiciousTeeter = false;
      noise = clamp(noise * 0.45, 0, 100);
    } else {
      phaseTimerSec -= dt;
      if (phaseTimerSec <= 0) {
        phase = 'RELAXED';
        phaseTimerSec = 0;
        relaxedElapsedSec = 0;
        suspiciousTeeter = false;
        noise = clamp(noise - 18, 0, 100);
      }
    }
  } else if (phase === 'CAUGHT') {
    phaseTimerSec -= dt;
    if (phaseTimerSec <= 0) {
      phase = 'RELAXED';
      phaseTimerSec = 0;
      relaxedElapsedSec = 0;
      suspiciousTeeter = false;
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
    distractTimerSec,
    distractCooldownSec,
    suspiciousTeeter,
    teeterPenaltyActive,
    finished,
    endReason,
  };
}

export interface PhoneBuzzStepResult {
  readonly nextCycleSec: number;
  readonly isBuzzing: boolean;
  readonly shouldSlideImpulse: boolean;
}

/**
 * 来电手机震动自滑逻辑：每 cycleSec（默认 4.2s）进入一次 0.65s 震动并向桌沿微滑。
 */
export function stepPhoneBuzz(
  prevCycleSec: number,
  dtSec: number,
  cycleSec = 4.2,
  buzzWindowSec = 0.65,
): PhoneBuzzStepResult {
  const next = prevCycleSec + Math.max(0, dtSec);
  if (next >= cycleSec) {
    const wrapped = next - cycleSec;
    return { nextCycleSec: wrapped, isBuzzing: true, shouldSlideImpulse: true };
  }
  const isBuzzing = next >= cycleSec - buzzWindowSec;
  return {
    nextCycleSec: next,
    isBuzzing,
    shouldSlideImpulse: isBuzzing && prevCycleSec < cycleSec - buzzWindowSec,
  };
}

export interface WaveSlot {
  readonly kind: ItemKind;
  readonly x: number;
}

/**
 * 生成每波桌面物品排版：
 * - 第 1 桌保持标准顺序（重物在左、轻物在右）。
 * - 第 2 桌起随机打乱物品站位顺序与间距，且确保顺序不同于第 1 桌默认排版。
 */
export function buildWaveLayout(
  waveNumber: number,
  stageItems: readonly ItemKind[],
  tableEdgeX: number = tuning.scene.tableEdgeX,
  rng: () => number = Math.random,
): WaveSlot[] {
  const count = stageItems.length;
  if (count === 0) return [];

  if (waveNumber <= 1) {
    const startX = 114;
    const endX = tableEdgeX - 24;
    const step = count > 1 ? (endX - startX) / (count - 1) : 0;
    return stageItems.map((kind, i) => ({
      kind,
      x: Math.round(startX + i * step),
    }));
  }

  const order = [...stageItems];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(clamp(rng(), 0, 0.9999) * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  // 确保第 2 桌起不会意外排成与第 1 桌完全一样的顺序
  if (order.length > 1 && order.every((k, idx) => k === stageItems[idx])) {
    const first = order[0];
    order[0] = order[order.length - 1];
    order[order.length - 1] = first;
  }

  const minX = 104;
  const maxX = tableEdgeX - 24;
  const span = maxX - minX;
  const baseStep = count > 1 ? span / (count - 1) : 0;

  return order.map((kind, idx) => {
    const jitter = (clamp(rng(), 0, 1) - 0.5) * Math.min(18, baseStep * 0.36);
    return {
      kind,
      x: Math.round(clamp(minX + idx * baseStep + jitter, minX, maxX)),
    };
  });
}

export function evaluateStageStars(
  totalScore: number,
  targetScore: number,
  hearts: number,
): 0 | 1 | 2 | 3 {
  if (hearts <= 0 || totalScore < targetScore) return 0;
  if (totalScore >= Math.round(targetScore * 1.75) && hearts >= 2) return 3;
  if (totalScore >= Math.round(targetScore * 1.35) || hearts >= 3) return 2;
  return 1;
}

export function createInitialProgress(): StageProgress {
  return {
    unlockedStage: 1,
    stars: { 1: 0, 2: 0, 3: 0, 4: 0 },
    bestScores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    endlessBestScore: 0,
  };
}

export function applyStageResult(
  prev: StageProgress,
  stageId: StageId,
  score: number,
  stars: 0 | 1 | 2 | 3,
): StageProgress {
  const nextUnlocked: StageId =
    stars > 0 && stageId < 4
      ? (Math.max(prev.unlockedStage, stageId + 1) as StageId)
      : prev.unlockedStage;
  return {
    ...prev,
    unlockedStage: nextUnlocked,
    stars: {
      ...prev.stars,
      [stageId]: Math.max(prev.stars[stageId], stars) as 0 | 1 | 2 | 3,
    },
    bestScores: {
      ...prev.bestScores,
      [stageId]: Math.max(prev.bestScores[stageId], Math.floor(score)),
    },
  };
}

const ALL_ITEM_KINDS: readonly ItemKind[] = [
  'tissue',
  'pen',
  'mug',
  'kettle',
  'mouse',
  'ink',
  'phone',
  'keyboard',
  'lipstick',
  'compact',
  'perfume',
  'mirror',
  'remote',
  'wineglass',
  'fishbowl',
];

export function createBillSummary(): BillSummary {
  const counts = {} as Record<ItemKind, number>;
  for (const kind of ALL_ITEM_KINDS) {
    counts[kind] = 0;
  }
  return {
    totalScore: 0,
    counts,
    teeterDrops: 0,
    extremeTeeterDrops: 0,
    damagedDrops: 0,
    records: [],
  };
}

export function recordItemDrop(
  bill: BillSummary,
  kind: ItemKind,
  multiplier: 1 | 2 | 3,
  t: Tuning = tuning,
  brokeOnTable = false,
): BillSummary {
  const score = calculateDropScore(kind, multiplier, brokeOnTable, t);
  return {
    totalScore: bill.totalScore + score,
    counts: {
      ...bill.counts,
      [kind]: bill.counts[kind] + 1,
    },
    teeterDrops: bill.teeterDrops + (!brokeOnTable && multiplier >= 2 ? 1 : 0),
    extremeTeeterDrops: bill.extremeTeeterDrops + (!brokeOnTable && multiplier === 3 ? 1 : 0),
    damagedDrops: bill.damagedDrops + (brokeOnTable ? 1 : 0),
    records: [...bill.records, { kind, multiplier, score, brokeOnTable }],
  };
}
