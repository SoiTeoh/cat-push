import type { StageId } from '../config/stages';
import { tuning, type DifficultyMode, type ItemKind, type Tuning } from '../config/tuning';

export type ScreenMode = 'title' | 'shop' | 'codex' | 'playing' | 'paused' | 'result';

export function shouldAdvanceSimulation(screenMode: ScreenMode): boolean {
  return screenMode === 'playing';
}

export type TeeterTier = 'safe' | 'teeter2' | 'teeter3';

export interface TeeterResult {
  readonly tier: TeeterTier;
  readonly multiplier: 1 | 2 | 3;
  readonly holdSec: number;
}

export type StewardPhase = 'RELAXED' | 'WARNING' | 'WATCHING' | 'CAUGHT';

export interface StewardState {
  readonly difficulty: DifficultyMode;
  readonly phase: StewardPhase;
  readonly phaseTimerSec: number;
  readonly relaxedElapsedSec: number;
  readonly noise: number;
  readonly hearts: number;
  readonly remainingSec: number;
  readonly distractTimerSec: number;
  readonly distractCooldownSec: number;
  readonly charmedTimerSec: number;
  readonly meowCooldownSec: number;
  readonly meowUsesThisRun: number;
  readonly meowResistant: boolean;
  readonly suspiciousTeeter: boolean;
  readonly suspiciousLabel: string | null;
  readonly teeterPenaltyActive: boolean;
  readonly restoreTargetId: number | null;
  readonly restoreTargetLabel: string | null;
  readonly restoreTimerSec: number;
  readonly restoreCountThisWatch: number;
  readonly lastRestoredId: number | null;
  readonly finished: boolean;
  readonly endReason: 'none' | 'hearts_zero' | 'time_up' | 'stage_cleared';
}

export interface DisplacedItemSnapshot {
  readonly id: number;
  readonly label: string;
  readonly x: number;
  readonly originX: number;
  readonly multiplier: 1 | 2 | 3;
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

export interface DifficultyProgress {
  readonly unlockedStage: StageId;
  readonly stars: Record<StageId, 0 | 1 | 2 | 3>;
  readonly bestScores: Record<StageId, number>;
  readonly endlessBestScore: number;
}

export interface StageProgress {
  readonly byDifficulty: Record<DifficultyMode, DifficultyProgress>;
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
  teeterScoreMultiplier = 1,
): number {
  const base = t.items[kind].baseScore;
  if (brokeOnTable) {
    return Math.round(base * 0.5);
  }
  const skinBonus = multiplier >= 2 ? teeterScoreMultiplier : 1;
  return Math.round(base * multiplier * skinBonus);
}

export function createStewardState(
  t: Tuning = tuning,
  difficulty: DifficultyMode = 'normal',
): StewardState {
  return {
    difficulty,
    phase: 'RELAXED',
    phaseTimerSec: 0,
    relaxedElapsedSec: 0,
    noise: 0,
    hearts: t.steward.maxHearts,
    remainingSec: t.steward.roundDurationSec,
    distractTimerSec: 0,
    distractCooldownSec: t.steward.distractMinCooldownSec,
    charmedTimerSec: 0,
    meowCooldownSec: 0,
    meowUsesThisRun: 0,
    meowResistant: false,
    suspiciousTeeter: false,
    suspiciousLabel: null,
    teeterPenaltyActive: false,
    restoreTargetId: null,
    restoreTargetLabel: null,
    restoreTimerSec: 0,
    restoreCountThisWatch: 0,
    lastRestoredId: null,
    finished: false,
    endReason: 'none',
  };
}

export function formatTeeterSuspicionText(label: string): string {
  return `嗯？${label}怎么歪了…`;
}

export function formatRestoreText(label: string): string {
  return `咦？谁动了我的${label}！`;
}

export function pickRestoreTarget(
  items: readonly DisplacedItemSnapshot[],
  t: Tuning = tuning,
  difficulty: DifficultyMode = 'normal',
): DisplacedItemSnapshot | null {
  const diff = t.difficulties[difficulty];
  if (diff.maxRestoresPerWatch <= 0) return null;
  const candidates = items.filter(
    (it) => it.multiplier >= 2 || it.x - it.originX >= diff.restoreDisplacementPx,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aTeeter = a.multiplier >= 2 ? 1 : 0;
    const bTeeter = b.multiplier >= 2 ? 1 : 0;
    if (aTeeter !== bTeeter) return bTeeter - aTeeter;
    return b.x - b.originX - (a.x - a.originX);
  });
  return candidates[0];
}

export function computeRestoredX(
  currentX: number,
  originX: number,
  pullRatio: number = tuning.steward.restorePullRatio,
): number {
  return originX + (currentX - originX) * (1 - clamp(pullRatio, 0, 1));
}

export function triggerMeowCharm(
  state: StewardState,
  t: Tuning = tuning,
  cooldownOverrideSec?: number,
  charmBonusSec = 0,
): { readonly state: StewardState; readonly triggered: boolean; readonly interruptedSteward: boolean } {
  if (state.finished || state.meowCooldownSec > 0) {
    return { state, triggered: false, interruptedSteward: false };
  }
  const interruptedSteward =
    state.phase === 'WARNING' || state.phase === 'WATCHING' || state.restoreTargetId !== null;
  const diff = t.difficulties[state.difficulty];
  const nextUses = state.meowUsesThisRun + 1;
  const isResistant =
    diff.meowResistantAfterUses !== null && nextUses >= diff.meowResistantAfterUses;
  const fullCharmSec =
    (isResistant ? diff.meowResistantDurationSec : t.cat.meowCharmDurationSec) + charmBonusSec;
  return {
    triggered: true,
    interruptedSteward,
    state: {
      ...state,
      phase: interruptedSteward ? 'RELAXED' : state.phase,
      phaseTimerSec: interruptedSteward ? 0 : state.phaseTimerSec,
      relaxedElapsedSec: interruptedSteward ? 0 : state.relaxedElapsedSec,
      charmedTimerSec: interruptedSteward ? fullCharmSec : fullCharmSec * 0.5,
      meowCooldownSec: cooldownOverrideSec ?? t.cat.meowCooldownSec,
      meowUsesThisRun: nextUses,
      meowResistant: isResistant,
      suspiciousTeeter: false,
      suspiciousLabel: null,
      restoreTargetId: null,
      restoreTargetLabel: null,
      restoreTimerSec: 0,
      restoreCountThisWatch: 0,
      lastRestoredId: null,
    },
  };
}

export function stepCatJump(
  jumpTimerSec: number,
  triggerJump: boolean,
  dtSec: number,
  t: Tuning = tuning,
): { readonly nextJumpTimerSec: number; readonly isAirborne: boolean; readonly heightOffsetPx: number } {
  let next = jumpTimerSec;
  if (triggerJump && jumpTimerSec <= 0) {
    next = t.cat.jumpDurationSec;
  } else {
    next = Math.max(0, jumpTimerSec - Math.max(0, dtSec));
  }
  const isAirborne = next > 0;
  const progress = 1 - next / t.cat.jumpDurationSec;
  const heightOffsetPx = isAirborne ? Math.sin(progress * Math.PI) * t.cat.jumpHeightPx : 0;
  return { nextJumpTimerSec: next, isAirborne, heightOffsetPx };
}

export function shouldBlockCatHorizontally(
  catX: number,
  nextX: number,
  moveDir: -1 | 0 | 1,
  isAirborne: boolean,
  itemLeftEdge: number,
  itemCenterX: number,
  bodyHalfW: number,
): boolean {
  if (isAirborne || moveDir <= 0) return false;
  return catX <= itemCenterX && nextX + bodyHalfW > itemLeftEdge - 2;
}

/** 根据噪声值计算铲屎官从 RELAXED 进入 WARNING 的间隔（噪声越高转头越快，受难度最低安全期下限保护）。 */
export function computeRelaxedInterval(
  noise: number,
  t: Tuning = tuning,
  difficulty: DifficultyMode = 'normal',
): number {
  const ratio = clamp(noise / 100, 0, 1);
  const minFloor = t.difficulties[difficulty].minRelaxedSec;
  const raw = t.steward.baseRelaxedSec - ratio * (t.steward.baseRelaxedSec - minFloor);
  return Math.max(minFloor, raw);
}

export interface StewardStepInput {
  readonly dtSec: number;
  readonly playerActive: boolean;
  readonly hasMovingItem: boolean;
  readonly itemDroppedDuringStep: boolean;
  readonly addedNoise: number;
  /** 桌面上是否存在悬边 >= ×2.0 的倾斜物品 */
  readonly hasTeeteringItem?: boolean;
  /** 悬边倾斜物品的名称（用于动态生成怀疑文案） */
  readonly teeteringItemLabel?: string | null;
  /** 桌面上需要被主人“物归原位”的偏离/悬边物品快照 */
  readonly restoreCandidate?: DisplacedItemSnapshot | null;
  /** 是否启用“悬边物品引发额外怀疑”（第 2 关起或无尽第 2 波起） */
  readonly enableTeeterSuspicion?: boolean;
  /** 技能“奥斯卡演技”延长的 ? 预警窗口秒数 */
  readonly warningBonusSec?: number;
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

  const diff = t.difficulties[state.difficulty];
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
    charmedTimerSec,
    meowCooldownSec,
    meowResistant,
    suspiciousTeeter,
    suspiciousLabel,
    teeterPenaltyActive,
    restoreTargetId,
    restoreTargetLabel,
    restoreTimerSec,
    restoreCountThisWatch,
  } = state;

  meowCooldownSec = Math.max(0, meowCooldownSec - dt);
  let lastRestoredId: number | null = null;

  if (phase === 'RELAXED') {
    if (charmedTimerSec > 0) {
      charmedTimerSec = Math.max(0, charmedTimerSec - dt);
      if (charmedTimerSec === 0) {
        meowResistant = false;
      }
    } else if (distractTimerSec > 0) {
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
        const baseInterval = computeRelaxedInterval(noise, t, state.difficulty);
        const interval = teeterPenaltyActive
          ? Math.max(diff.minRelaxedSec, baseInterval - t.steward.teeterRelaxedPenaltySec)
          : baseInterval;
        if (relaxedElapsedSec >= interval) {
          phase = 'WARNING';
          phaseTimerSec = diff.warningDurationSec + (input.warningBonusSec ?? 0);
          relaxedElapsedSec = 0;
        }
      }
    }
  } else if (phase === 'WARNING') {
    distractTimerSec = 0;
    charmedTimerSec = 0;
    meowResistant = false;
    phaseTimerSec -= dt;
    if (phaseTimerSec <= 0) {
      const roll = clamp(input.watchRoll ?? 0.5, 0, 1);
      const teeterSuspicion = Boolean(input.enableTeeterSuspicion && input.hasTeeteringItem);
      phase = 'WATCHING';
      phaseTimerSec =
        t.steward.watchMinSec +
        roll * (t.steward.watchMaxSec - t.steward.watchMinSec) +
        (teeterSuspicion ? diff.teeterWatchBonusSec : 0);
      suspiciousTeeter = teeterSuspicion;
      suspiciousLabel = teeterSuspicion ? (input.teeteringItemLabel ?? '东西') : null;
      teeterPenaltyActive = teeterSuspicion;
      restoreCountThisWatch = 0;
    }
  } else if (phase === 'WATCHING') {
    const caught =
      input.playerActive || input.hasMovingItem || input.itemDroppedDuringStep;
    if (caught) {
      hearts = Math.max(0, hearts - 1);
      phase = 'CAUGHT';
      phaseTimerSec = t.steward.caughtPauseSec;
      suspiciousTeeter = false;
      suspiciousLabel = null;
      restoreTargetId = null;
      restoreTargetLabel = null;
      restoreTimerSec = 0;
      restoreCountThisWatch = 0;
      noise = clamp(noise * 0.45, 0, 100);
    } else {
      if (
        restoreTargetId === null &&
        restoreCountThisWatch < diff.maxRestoresPerWatch &&
        input.restoreCandidate
      ) {
        restoreTargetId = input.restoreCandidate.id;
        restoreTargetLabel = input.restoreCandidate.label;
        restoreTimerSec = t.steward.restoreDurationSec;
        restoreCountThisWatch += 1;
        phaseTimerSec = Math.max(phaseTimerSec, restoreTimerSec + 0.15);
      }
      if (restoreTargetId !== null) {
        restoreTimerSec -= dt;
        if (restoreTimerSec <= 0) {
          lastRestoredId = restoreTargetId;
          restoreTargetId = null;
          restoreTargetLabel = null;
          restoreTimerSec = 0;
        }
      }
      phaseTimerSec -= dt;
      if (phaseTimerSec <= 0) {
        phase = 'RELAXED';
        phaseTimerSec = 0;
        relaxedElapsedSec = 0;
        suspiciousTeeter = false;
        suspiciousLabel = null;
        restoreTargetId = null;
        restoreTargetLabel = null;
        restoreTimerSec = 0;
        restoreCountThisWatch = 0;
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
      suspiciousLabel = null;
      restoreCountThisWatch = 0;
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
    difficulty: state.difficulty,
    phase,
    phaseTimerSec,
    relaxedElapsedSec,
    noise,
    hearts,
    remainingSec,
    distractTimerSec,
    distractCooldownSec,
    charmedTimerSec,
    meowCooldownSec,
    meowUsesThisRun: state.meowUsesThisRun,
    meowResistant,
    suspiciousTeeter,
    suspiciousLabel,
    teeterPenaltyActive,
    restoreTargetId,
    restoreTargetLabel,
    restoreTimerSec,
    restoreCountThisWatch,
    lastRestoredId,
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
  t: Tuning = tuning,
): WaveSlot[] {
  const count = stageItems.length;
  if (count === 0) return [];

  const safeRightX = (kind: ItemKind): number =>
    tableEdgeX - 42 - t.items[kind].width * 0.5;

  if (waveNumber <= 1) {
    const startX = 104;
    const endX = Math.min(tableEdgeX - 60, 236);
    const step = count > 1 ? (endX - startX) / (count - 1) : 0;
    return stageItems.map((kind, i) => ({
      kind,
      x: Math.round(Math.min(startX + i * step, safeRightX(kind))),
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

  const minX = 102;
  const maxX = Math.min(tableEdgeX - 60, 236);
  const span = maxX - minX;
  const baseStep = count > 1 ? span / (count - 1) : 0;

  return order.map((kind, idx) => {
    const jitter = (clamp(rng(), 0, 1) - 0.5) * Math.min(14, baseStep * 0.3);
    const rawX = minX + idx * baseStep + jitter;
    return {
      kind,
      x: Math.round(clamp(rawX, minX, safeRightX(kind))),
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

function createEmptyDifficultyProgress(): DifficultyProgress {
  return {
    unlockedStage: 1,
    stars: { 1: 0, 2: 0, 3: 0, 4: 0 },
    bestScores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    endlessBestScore: 0,
  };
}

export function createInitialProgress(): StageProgress {
  return {
    byDifficulty: {
      easy: createEmptyDifficultyProgress(),
      normal: createEmptyDifficultyProgress(),
      hard: createEmptyDifficultyProgress(),
    },
  };
}

export function applyStageResult(
  prev: StageProgress,
  difficulty: DifficultyMode,
  stageId: StageId,
  score: number,
  stars: 0 | 1 | 2 | 3,
): StageProgress {
  const cur = prev.byDifficulty[difficulty];
  const nextUnlocked: StageId =
    stars > 0 && stageId < 4
      ? (Math.max(cur.unlockedStage, stageId + 1) as StageId)
      : cur.unlockedStage;
  return {
    byDifficulty: {
      ...prev.byDifficulty,
      [difficulty]: {
        ...cur,
        unlockedStage: nextUnlocked,
        stars: {
          ...cur.stars,
          [stageId]: Math.max(cur.stars[stageId], stars) as 0 | 1 | 2 | 3,
        },
        bestScores: {
          ...cur.bestScores,
          [stageId]: Math.max(cur.bestScores[stageId], Math.floor(score)),
        },
      },
    },
  };
}

export function applyEndlessResult(
  prev: StageProgress,
  difficulty: DifficultyMode,
  score: number,
): StageProgress {
  const cur = prev.byDifficulty[difficulty];
  return {
    byDifficulty: {
      ...prev.byDifficulty,
      [difficulty]: {
        ...cur,
        endlessBestScore: Math.max(cur.endlessBestScore, Math.floor(score)),
      },
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
  teeterScoreMultiplier = 1,
): BillSummary {
  const score = calculateDropScore(kind, multiplier, brokeOnTable, t, teeterScoreMultiplier);
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
