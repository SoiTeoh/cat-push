import { describe, expect, it } from 'vitest';
import { STAGES, STAGE_IDS } from '../src/config/stages';
import { tuning } from '../src/config/tuning';
import {
  applyEndlessResult,
  applyStageResult,
  buildWaveLayout,
  calculateDropScore,
  computeRelaxedInterval,
  computeRestoredX,
  computeRivalWarningReactionSec,
  createBillSummary,
  createInitialProgress,
  createStewardState,
  decideRivalAction,
  evaluateStageStars,
  evaluateTeeterState,
  evaluateVersusOutcome,
  evaluateVersusResult,
  evaluateVersusWatch,
  formatRestoreText,
  formatTeeterSuspicionText,
  isFragileBrokenOnTable,
  isItemOwnershipLocked,
  pickRestoreTarget,
  recordItemDrop,
  resolveCatGroundSeparation,
  resolveDropOwner,
  shouldAdvanceSimulation,
  shouldBlockCatHorizontally,
  stepCatJump,
  stepPhoneBuzz,
  stepSteward,
  triggerMeowCharm,
  type StewardState,
} from '../src/game/rules';
import { calculateCanCoinsReward, sanitizeProgression } from '../src/game/progression';

const DEG = Math.PI / 180;

describe('evaluateTeeterState', () => {
  const edgeX = tuning.scene.tableEdgeX;

  it('returns safe ×1 when item is far from table edge', () => {
    const res = evaluateTeeterState(edgeX - 80, 12 * DEG, edgeX, 0, 0.1, false, tuning);
    expect(res.tier).toBe('safe');
    expect(res.multiplier).toBe(1);
    expect(res.holdSec).toBe(0);
  });

  it('returns safe ×1 when item is near edge but tilt angle is <= 6 deg', () => {
    const res = evaluateTeeterState(edgeX - 10, 5 * DEG, edgeX, 0, 0.1, false, tuning);
    expect(res.tier).toBe('safe');
    expect(res.multiplier).toBe(1);
    expect(res.holdSec).toBe(0);
  });

  it('enters teeter2 (×2) when near edge and tilt > 6 deg', () => {
    const res = evaluateTeeterState(edgeX - 8, 8 * DEG, edgeX, 0, 0.25, false, tuning);
    expect(res.tier).toBe('teeter2');
    expect(res.multiplier).toBe(2);
    expect(res.holdSec).toBeCloseTo(0.25, 4);
  });

  it('upgrades to teeter3 (×3) once holdSec reaches tier2HoldSec (1.5s)', () => {
    const res = evaluateTeeterState(edgeX + 2, -10 * DEG, edgeX, 1.4, 0.2, false, tuning);
    expect(res.tier).toBe('teeter3');
    expect(res.multiplier).toBe(3);
    expect(res.holdSec).toBeCloseTo(1.6, 4);
  });

  it('resets holdSec to 0 when item moves back to safe state', () => {
    const res = evaluateTeeterState(edgeX - 90, 0, edgeX, 1.2, 0.1, false, tuning);
    expect(res.tier).toBe('safe');
    expect(res.multiplier).toBe(1);
    expect(res.holdSec).toBe(0);
  });

  it('preserves previous multiplier and holdSec when alreadyDropped is true', () => {
    const res = evaluateTeeterState(edgeX + 60, 0, edgeX, 1.7, 0.5, true, tuning);
    expect(res.tier).toBe('teeter3');
    expect(res.multiplier).toBe(3);
    expect(res.holdSec).toBe(1.7);
  });
});

describe('computeRelaxedInterval', () => {
  it('decreases monotonically as noise rises from 0 to 100', () => {
    const at0 = computeRelaxedInterval(0, tuning);
    const at50 = computeRelaxedInterval(50, tuning);
    const at100 = computeRelaxedInterval(100, tuning);

    expect(at0).toBeGreaterThan(at50);
    expect(at50).toBeGreaterThan(at100);
    expect(at100).toBeCloseTo(tuning.difficulties.normal.minRelaxedSec, 4);
  });
});

describe('stepSteward', () => {
  it('transitions RELAXED -> WARNING once relaxedElapsedSec reaches interval', () => {
    let s = createStewardState(tuning);
    const interval = computeRelaxedInterval(0, tuning);
    s = stepSteward(
      s,
      {
        dtSec: interval + 0.05,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WARNING');
    expect(s.hearts).toBe(tuning.steward.maxHearts);
  });

  it('transitions WARNING -> WATCHING after warningDurationSec', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WARNING', phaseTimerSec: tuning.steward.warningDurationSec };
    s = stepSteward(
      s,
      {
        dtSec: tuning.steward.warningDurationSec + 0.02,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WATCHING');
    expect(s.hearts).toBe(tuning.steward.maxHearts);
  });

  it('escapes WATCHING safely when cat naps and no item is moving or dropped', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WATCHING', phaseTimerSec: 0.2 };
    s = stepSteward(
      s,
      {
        dtSec: 0.3,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('RELAXED');
    expect(s.hearts).toBe(tuning.steward.maxHearts);
  });

  it('triggers CAUGHT and loses 1 heart if player is active during WATCHING', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WATCHING', phaseTimerSec: 1.5 };
    s = stepSteward(
      s,
      {
        dtSec: 0.05,
        playerActive: true,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('CAUGHT');
    expect(s.hearts).toBe(tuning.steward.maxHearts - 1);
  });

  it('triggers CAUGHT if a rolling/moving item or drop occurs during WATCHING even if cat is still', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WATCHING', phaseTimerSec: 1.5 };
    s = stepSteward(
      s,
      {
        dtSec: 0.05,
        playerActive: false,
        hasMovingItem: true,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('CAUGHT');
    expect(s.hearts).toBe(tuning.steward.maxHearts - 1);
  });

  it('recovers from CAUGHT to RELAXED after caughtPauseSec when hearts remain', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'CAUGHT', phaseTimerSec: 0.1, hearts: 2 };
    s = stepSteward(
      s,
      {
        dtSec: 0.15,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('RELAXED');
    expect(s.finished).toBe(false);
  });

  it('finishes with endReason hearts_zero when 3rd heart is lost', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WATCHING', phaseTimerSec: 1.0, hearts: 1 };
    s = stepSteward(
      s,
      {
        dtSec: 0.05,
        playerActive: true,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.hearts).toBe(0);
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('hearts_zero');
  });

  it('finishes with endReason time_up when remainingSec reaches 0 and stops advancing', () => {
    let s = createStewardState(tuning);
    s = { ...s, remainingSec: 0.1 };
    s = stepSteward(
      s,
      {
        dtSec: 0.2,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.finished).toBe(true);
    expect(s.endReason).toBe('time_up');
    expect(s.remainingSec).toBe(0);

    const after = stepSteward(
      s,
      {
        dtSec: 1.0,
        playerActive: true,
        hasMovingItem: true,
        itemDroppedDuringStep: true,
        addedNoise: 50,
      },
      tuning,
    );
    expect(after).toEqual(s);
  });

  it('extends WATCHING by +0.6s and flags suspiciousTeeter when teeter suspicion is enabled', () => {
    let s = createStewardState(tuning);
    s = { ...s, phase: 'WARNING', phaseTimerSec: 0.05 };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        hasTeeteringItem: true,
        enableTeeterSuspicion: true,
        watchRoll: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WATCHING');
    expect(s.suspiciousTeeter).toBe(true);
    expect(s.teeterPenaltyActive).toBe(true);
    expect(s.phaseTimerSec).toBeCloseTo(
      tuning.steward.watchMinSec + tuning.steward.teeterWatchBonusSec,
      4,
    );
  });

  it('shortens next RELAXED interval when teeterPenaltyActive is true', () => {
    const baseInterval = computeRelaxedInterval(0, tuning);
    let s: StewardState = {
      ...createStewardState(tuning),
      phase: 'RELAXED',
      teeterPenaltyActive: true,
      relaxedElapsedSec: baseInterval - tuning.steward.teeterRelaxedPenaltySec - 0.05,
    };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WARNING');
  });

  it('blocks WARNING transition while steward distraction window is active', () => {
    let s: StewardState = {
      ...createStewardState(tuning),
      phase: 'RELAXED',
      relaxedElapsedSec: 10,
      distractTimerSec: 2.0,
    };
    s = stepSteward(
      s,
      {
        dtSec: 0.5,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 80,
      },
      tuning,
    );
    expect(s.phase).toBe('RELAXED');
    expect(s.distractTimerSec).toBeCloseTo(1.5, 4);
  });

  it('triggers distraction window when distractCooldownSec reaches 0 during RELAXED', () => {
    let s: StewardState = {
      ...createStewardState(tuning),
      phase: 'RELAXED',
      distractCooldownSec: 0.1,
    };
    s = stepSteward(
      s,
      {
        dtSec: 0.2,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        distractRoll: 0.5,
      },
      tuning,
    );
    expect(s.phase).toBe('RELAXED');
    expect(s.distractTimerSec).toBeCloseTo(tuning.steward.distractDurationSec, 4);
  });
});

describe('Fragile Items, Phone Buzz & Wave Layout', () => {
  it('detects premature table shatter for perfume and wineglass when tilted >= 65 deg away from edge', () => {
    const edgeX = tuning.scene.tableEdgeX;
    expect(isFragileBrokenOnTable('perfume', edgeX - 60, 70 * DEG, edgeX, tuning)).toBe(true);
    expect(isFragileBrokenOnTable('wineglass', edgeX - 80, -68 * DEG, edgeX, tuning)).toBe(true);
    // Near the edge (>= edgeX - edgeMarginPx), tilting is teetering, not table-break
    expect(isFragileBrokenOnTable('perfume', edgeX - 10, 70 * DEG, edgeX, tuning)).toBe(false);
    // Non-fragile items never break on table
    expect(isFragileBrokenOnTable('kettle', edgeX - 60, 80 * DEG, edgeX, tuning)).toBe(false);
  });

  it('awards 50% damaged score when brokeOnTable is true vs full multiplied score when pushed off', () => {
    expect(calculateDropScore('perfume', 3, true, tuning)).toBe(110);
    expect(calculateDropScore('perfume', 3, false, tuning)).toBe(660);
    expect(calculateDropScore('wineglass', 2, true, tuning)).toBe(130);
    expect(calculateDropScore('wineglass', 2, false, tuning)).toBe(520);
  });

  it('steps phone buzz cycle and emits slide impulse when entering buzz window', () => {
    const r1 = stepPhoneBuzz(3.4, 0.2, 4.2, 0.65);
    expect(r1.isBuzzing).toBe(true);
    expect(r1.shouldSlideImpulse).toBe(true);

    const r2 = stepPhoneBuzz(3.7, 0.2, 4.2, 0.65);
    expect(r2.isBuzzing).toBe(true);
    expect(r2.shouldSlideImpulse).toBe(false);
  });

  it('keeps wave 1 in canonical order and shuffles wave 2+ so order differs from wave 1', () => {
    const items = STAGES[1].items;
    const w1 = buildWaveLayout(1, items, tuning.scene.tableEdgeX);
    expect(w1.map((s) => s.kind)).toEqual(items);

    const w2 = buildWaveLayout(2, items, tuning.scene.tableEdgeX, () => 0.99);
    expect(w2).toHaveLength(items.length);
    expect(w2.map((s) => s.kind)).not.toEqual(items);
  });
});

describe('Stages, Stars & BillSummary', () => {
  it('defines 4 distinct stages with increasing target scores and unique items', () => {
    expect(STAGE_IDS).toEqual([1, 2, 3, 4]);
    expect(STAGES[1].targetScore).toBe(300);
    expect(STAGES[2].targetScore).toBe(550);
    expect(STAGES[3].targetScore).toBe(800);
    expect(STAGES[4].targetScore).toBe(1100);
    expect(STAGES[1].enableTeeterSuspicion).toBe(false);
    expect(STAGES[2].enableTeeterSuspicion).toBe(true);
  });

  it('evaluates 0..3 stage stars accurately based on score, targetScore, and hearts', () => {
    expect(evaluateStageStars(299, 300, 3)).toBe(0);
    expect(evaluateStageStars(500, 300, 0)).toBe(0);
    expect(evaluateStageStars(320, 300, 1)).toBe(1);
    expect(evaluateStageStars(320, 300, 3)).toBe(2);
    expect(evaluateStageStars(410, 300, 2)).toBe(2);
    expect(evaluateStageStars(530, 300, 2)).toBe(3);
  });

  it('unlocks next stage and preserves best star & score per difficulty in StageProgress', () => {
    let p = createInitialProgress();
    p = applyStageResult(p, 'normal', 1, 350, 2);
    expect(p.byDifficulty.normal.unlockedStage).toBe(2);
    expect(p.byDifficulty.normal.stars[1]).toBe(2);
    expect(p.byDifficulty.normal.bestScores[1]).toBe(350);
    // Other difficulties remain independent
    expect(p.byDifficulty.hard.unlockedStage).toBe(1);
    expect(p.byDifficulty.hard.stars[1]).toBe(0);

    // Replaying with lower stars keeps higher star record
    p = applyStageResult(p, 'normal', 1, 310, 1);
    expect(p.byDifficulty.normal.stars[1]).toBe(2);
    expect(p.byDifficulty.normal.bestScores[1]).toBe(350);
  });

  it('accumulates base scores, multipliers, teeter counts, and damagedDrops accurately', () => {
    let bill = createBillSummary();
    expect(bill.totalScore).toBe(0);

    bill = recordItemDrop(bill, 'tissue', 1, tuning); // +10
    bill = recordItemDrop(bill, 'pen', 2, tuning); // +60, teeterDrops=1
    bill = recordItemDrop(bill, 'mug', 3, tuning); // +240, teeterDrops=2, extreme=1
    bill = recordItemDrop(bill, 'perfume', 3, tuning, true); // +110 damaged

    expect(bill.totalScore).toBe(10 + 60 + 240 + 110);
    expect(bill.counts.tissue).toBe(1);
    expect(bill.counts.perfume).toBe(1);
    expect(bill.teeterDrops).toBe(2);
    expect(bill.extremeTeeterDrops).toBe(1);
    expect(bill.damagedDrops).toBe(1);
    expect(bill.records).toHaveLength(4);
  });
});

describe('V2.0 Phase A: Dynamic Labels, Restore Tug-of-War, Meow Charm & Jump', () => {
  it('formats dynamic suspicion and restore labels from actual item names', () => {
    expect(formatTeeterSuspicionText('圆柱口红')).toBe('嗯？圆柱口红怎么歪了…');
    expect(formatRestoreText('金鱼圆形鱼缸')).toBe('咦？谁动了我的金鱼圆形鱼缸！');
  });

  it('stores dynamic teeteringItemLabel on StewardState when suspiciousTeeter triggers', () => {
    let s: StewardState = { ...createStewardState(tuning), phase: 'WARNING', phaseTimerSec: 0.05 };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        hasTeeteringItem: true,
        teeteringItemLabel: '高脚红酒杯',
        enableTeeterSuspicion: true,
      },
      tuning,
    );
    expect(s.suspiciousTeeter).toBe(true);
    expect(s.suspiciousLabel).toBe('高脚红酒杯');
  });

  it('picks teetering items with priority over displaced items for steward restore', () => {
    const target = pickRestoreTarget(
      [
        { id: 1, label: '电水壶', x: 180, originX: 114, multiplier: 1 }, // +66px
        { id: 2, label: '圆珠笔', x: 280, originX: 250, multiplier: 2 }, // +30px but teetering!
        { id: 3, label: '纸巾团', x: 270, originX: 260, multiplier: 1 }, // +10px safe
      ],
      tuning,
    );
    expect(target?.id).toBe(2);
    expect(computeRestoredX(180, 114, 0.58)).toBeCloseTo(141.72, 2);
  });

  it('ignores items displaced less than restoreDisplacementPx (38px) when not teetering', () => {
    const target = pickRestoreTarget(
      [{ id: 1, label: '电水壶', x: 145, originX: 114, multiplier: 1 }],
      tuning,
    );
    expect(target).toBeNull();
  });

  it('runs steward restore timer during WATCHING and emits lastRestoredId on completion', () => {
    let s: StewardState = {
      ...createStewardState(tuning),
      phase: 'WATCHING',
      phaseTimerSec: 1.5,
    };
    const candidate = { id: 7, label: '机械键盘', x: 200, originX: 120, multiplier: 1 as const };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        restoreCandidate: candidate,
      },
      tuning,
    );
    expect(s.restoreTargetId).toBe(7);
    expect(s.restoreTargetLabel).toBe('机械键盘');

    s = stepSteward(
      s,
      {
        dtSec: tuning.steward.restoreDurationSec,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.lastRestoredId).toBe(7);
    expect(s.restoreTargetId).toBeNull();
  });

  it('interrupts WARNING/WATCHING and active restore hand with Meow Charm and enforces 9.0s cooldown', () => {
    const watching: StewardState = {
      ...createStewardState(tuning),
      phase: 'WATCHING',
      phaseTimerSec: 1.2,
      restoreTargetId: 3,
      restoreTargetLabel: '香水瓶',
      restoreTimerSec: 0.5,
    };
    const res1 = triggerMeowCharm(watching, tuning);
    expect(res1.triggered).toBe(true);
    expect(res1.interruptedSteward).toBe(true);
    expect(res1.state.phase).toBe('RELAXED');
    expect(res1.state.charmedTimerSec).toBeCloseTo(tuning.cat.meowCharmDurationSec, 4);
    expect(res1.state.restoreTargetId).toBeNull();
    expect(res1.state.meowCooldownSec).toBeCloseTo(tuning.cat.meowCooldownSec, 4);

    // Consecutive spam blocked while on cooldown
    const res2 = triggerMeowCharm(res1.state, tuning);
    expect(res2.triggered).toBe(false);
  });

  it('pauses WARNING transition while charmedTimerSec > 0 and decrements meowCooldownSec', () => {
    let s: StewardState = {
      ...createStewardState(tuning),
      phase: 'RELAXED',
      relaxedElapsedSec: 10,
      charmedTimerSec: 1.5,
      meowCooldownSec: 9.0,
    };
    s = stepSteward(
      s,
      {
        dtSec: 0.5,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 60,
      },
      tuning,
    );
    expect(s.phase).toBe('RELAXED');
    expect(s.charmedTimerSec).toBeCloseTo(1.0, 4);
    expect(s.meowCooldownSec).toBeCloseTo(8.5, 4);
  });

  it('computes 0.42s parabolic cat jump and disables horizontal blocking while airborne', () => {
    const start = stepCatJump(0, true, 0, tuning);
    expect(start.isAirborne).toBe(true);
    expect(start.nextJumpTimerSec).toBeCloseTo(tuning.cat.jumpDurationSec, 4);

    const mid = stepCatJump(start.nextJumpTimerSec, false, tuning.cat.jumpDurationSec / 2, tuning);
    expect(mid.isAirborne).toBe(true);
    expect(mid.heightOffsetPx).toBeCloseTo(tuning.cat.jumpHeightPx, 1);

    // Grounded blocks, airborne passes over!
    expect(shouldBlockCatHorizontally(90, 96, 1, false, 110, 130, 22)).toBe(true);
    expect(shouldBlockCatHorizontally(90, 96, 1, true, 110, 130, 22)).toBe(false);

    const landed = stepCatJump(mid.nextJumpTimerSec, false, tuning.cat.jumpDurationSec, tuning);
    expect(landed.isAirborne).toBe(false);
    expect(landed.heightOffsetPx).toBe(0);
  });
});

describe('3-Tier Difficulty Mode & Restore Rebalance (Phase A+)', () => {
  it('disables steward restore completely in easy mode and uses 1.05s warning', () => {
    const items = [{ id: 1, label: '马克杯', x: 240, originX: 140, multiplier: 2 as const }];
    expect(pickRestoreTarget(items, tuning, 'easy')).toBeNull();

    let s: StewardState = {
      ...createStewardState(tuning, 'easy'),
      phase: 'RELAXED',
      relaxedElapsedSec: 10,
    };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WARNING');
    expect(s.phaseTimerSec).toBeCloseTo(1.05, 4);

    s = { ...s, phase: 'WATCHING', phaseTimerSec: 1.5 };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        restoreCandidate: items[0],
      },
      tuning,
    );
    expect(s.restoreTargetId).toBeNull();
  });

  it('caps normal mode to 1 restore per WATCHING turn with 42px threshold and 40% pullback', () => {
    expect(pickRestoreTarget([{ id: 1, label: '笔', x: 140, originX: 100, multiplier: 1 }], tuning, 'normal')).toBeNull();
    expect(pickRestoreTarget([{ id: 1, label: '笔', x: 143, originX: 100, multiplier: 1 }], tuning, 'normal')?.id).toBe(1);
    expect(computeRestoredX(200, 100, tuning.difficulties.normal.restorePullRatio)).toBeCloseTo(160, 4);

    let s: StewardState = {
      ...createStewardState(tuning, 'normal'),
      phase: 'WATCHING',
      phaseTimerSec: 2.0,
    };
    const cand1 = { id: 1, label: '马克杯', x: 190, originX: 120, multiplier: 1 as const };
    const cand2 = { id: 2, label: '香水瓶', x: 210, originX: 140, multiplier: 1 as const };

    s = stepSteward(
      s,
      { dtSec: 0.1, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand1 },
      tuning,
    );
    expect(s.restoreTargetId).toBe(1);
    expect(s.restoreCountThisWatch).toBe(1);

    // Finish 1st restore
    s = stepSteward(
      s,
      { dtSec: tuning.steward.restoreDurationSec, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand2 },
      tuning,
    );
    expect(s.lastRestoredId).toBe(1);
    expect(s.restoreTargetId).toBeNull();

    // 2nd candidate in same WATCHING turn is ignored in normal mode
    s = stepSteward(
      s,
      { dtSec: 0.1, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand2 },
      tuning,
    );
    expect(s.restoreTargetId).toBeNull();
  });

  it('allows up to 2 restores per WATCHING turn in hard mode with 28px threshold and 60% pullback', () => {
    expect(pickRestoreTarget([{ id: 1, label: '笔', x: 129, originX: 100, multiplier: 1 }], tuning, 'hard')?.id).toBe(1);
    expect(computeRestoredX(200, 100, tuning.difficulties.hard.restorePullRatio)).toBeCloseTo(140, 4);

    let s: StewardState = {
      ...createStewardState(tuning, 'hard'),
      phase: 'WATCHING',
      phaseTimerSec: 2.0,
    };
    const cand1 = { id: 1, label: '马克杯', x: 190, originX: 120, multiplier: 1 as const };
    const cand2 = { id: 2, label: '香水瓶', x: 210, originX: 140, multiplier: 1 as const };

    s = stepSteward(
      s,
      { dtSec: 0.1, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand1 },
      tuning,
    );
    expect(s.restoreTargetId).toBe(1);

    s = stepSteward(
      s,
      { dtSec: tuning.steward.restoreDurationSec, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand2 },
      tuning,
    );
    expect(s.lastRestoredId).toBe(1);

    // 2nd candidate IS picked up in hard mode!
    s = stepSteward(
      s,
      { dtSec: 0.05, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0, restoreCandidate: cand2 },
      tuning,
    );
    expect(s.restoreTargetId).toBe(2);
    expect(s.restoreCountThisWatch).toBe(2);
  });

  it('uses 0.78s warning and +0.8s teeter watch bonus in hard mode', () => {
    let s: StewardState = {
      ...createStewardState(tuning, 'hard'),
      phase: 'RELAXED',
      relaxedElapsedSec: 10,
    };
    s = stepSteward(
      s,
      { dtSec: 0.1, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0 },
      tuning,
    );
    expect(s.phase).toBe('WARNING');
    expect(s.phaseTimerSec).toBeCloseTo(0.78, 4);

    s = { ...s, phaseTimerSec: 0.05 };
    s = stepSteward(
      s,
      {
        dtSec: 0.1,
        playerActive: false,
        hasMovingItem: false,
        itemDroppedDuringStep: false,
        addedNoise: 0,
        hasTeeteringItem: true,
        enableTeeterSuspicion: true,
        watchRoll: 0,
      },
      tuning,
    );
    expect(s.phase).toBe('WATCHING');
    expect(s.phaseTimerSec).toBeCloseTo(tuning.steward.watchMinSec + 0.8, 4);
  });

  it('decays 3rd+ Meow Charm pause to 1.0s with meowResistant in hard mode', () => {
    let s = createStewardState(tuning, 'hard');
    // 1st use (interrupting WARNING) -> 1.8s
    const r1 = triggerMeowCharm({ ...s, phase: 'WARNING', phaseTimerSec: 0.5 }, tuning);
    expect(r1.state.charmedTimerSec).toBeCloseTo(1.8, 4);
    expect(r1.state.meowResistant).toBe(false);
    expect(r1.state.meowUsesThisRun).toBe(1);

    // 2nd use -> still 1.8s
    const r2 = triggerMeowCharm({ ...r1.state, meowCooldownSec: 0, phase: 'WARNING', phaseTimerSec: 0.5 }, tuning);
    expect(r2.state.charmedTimerSec).toBeCloseTo(1.8, 4);
    expect(r2.state.meowResistant).toBe(false);
    expect(r2.state.meowUsesThisRun).toBe(2);

    // 3rd use -> resistant! 1.0s
    const r3 = triggerMeowCharm({ ...r2.state, meowCooldownSec: 0, phase: 'WATCHING', phaseTimerSec: 1.0 }, tuning);
    expect(r3.state.charmedTimerSec).toBeCloseTo(1.0, 4);
    expect(r3.state.meowResistant).toBe(true);
    expect(r3.state.meowUsesThisRun).toBe(3);
  });

  it('distinguishes 35px displacement between normal (42px) and hard (28px) restore thresholds', () => {
    const items = [{ id: 5, label: '马克杯', x: 155, originX: 120, multiplier: 1 as const }];
    expect(pickRestoreTarget(items, tuning, 'normal')).toBeNull();
    expect(pickRestoreTarget(items, tuning, 'hard')?.id).toBe(5);
  });

  it('tracks endlessBestScore independently per difficulty in StageProgress', () => {
    let p = createInitialProgress();
    p = applyEndlessResult(p, 'easy', 920);
    p = applyEndlessResult(p, 'hard', 410);
    expect(p.byDifficulty.easy.endlessBestScore).toBe(920);
    expect(p.byDifficulty.normal.endlessBestScore).toBe(0);
    expect(p.byDifficulty.hard.endlessBestScore).toBe(410);
  });

  it('enforces minimum RELAXED safe interval floor (>= 2.6s easy/normal, >= 2.1s hard) even at 100% noise', () => {
    expect(computeRelaxedInterval(100, tuning, 'easy')).toBeCloseTo(2.6, 4);
    expect(computeRelaxedInterval(100, tuning, 'normal')).toBeCloseTo(2.6, 4);
    expect(computeRelaxedInterval(100, tuning, 'hard')).toBeCloseTo(2.1, 4);

    // Even with teeterPenaltyActive and 100% noise, RELAXED never triggers before 2.6s (normal) / 2.1s (hard)
    let normalState: StewardState = {
      ...createStewardState(tuning, 'normal'),
      phase: 'RELAXED',
      noise: 100,
      teeterPenaltyActive: true,
      relaxedElapsedSec: 2.4,
    };
    normalState = stepSteward(
      normalState,
      { dtSec: 0.1, playerActive: false, hasMovingItem: false, itemDroppedDuringStep: false, addedNoise: 0 },
      tuning,
    );
    expect(normalState.phase).toBe('RELAXED');
  });

  it('freezes simulation when paused and cleanly resets state when exiting to title', () => {
    expect(shouldAdvanceSimulation('playing')).toBe(true);
    expect(shouldAdvanceSimulation('paused')).toBe(false);
    expect(shouldAdvanceSimulation('title')).toBe(false);
    expect(shouldAdvanceSimulation('shop')).toBe(false);
    expect(shouldAdvanceSimulation('codex')).toBe(false);
    expect(shouldAdvanceSimulation('result')).toBe(false);

    // When paused, simulation guard prevents advancing steward countdown or bill
    let steward = createStewardState(tuning, 'normal');
    let bill = createBillSummary();
    bill = recordItemDrop(bill, 'mug', 2, tuning);
    const beforeRemaining = steward.remainingSec;

    if (shouldAdvanceSimulation('paused')) {
      steward = stepSteward(
        steward,
        { dtSec: 1.0, playerActive: true, hasMovingItem: true, itemDroppedDuringStep: false, addedNoise: 50 },
        tuning,
      );
    }
    expect(steward.remainingSec).toBe(beforeRemaining);
    expect(bill.totalScore).toBeGreaterThan(0);

    // Exiting to title resets steward & bill cleanly
    steward = createStewardState(tuning, 'normal');
    bill = createBillSummary();
    expect(steward.remainingSec).toBe(tuning.steward.roundDurationSec);
    expect(steward.hearts).toBe(tuning.steward.maxHearts);
    expect(bill.totalScore).toBe(0);
    expect(bill.records).toHaveLength(0);
  });
});

describe('Versus Mode & Blame Shift (Phase B2)', () => {
  it('resolves drop owner to lastTouchedBy within touchExpirySec and defaults to player', () => {
    expect(resolveDropOwner('rival', 1.0, 2.5)).toBe('rival');
    expect(resolveDropOwner('player', 2.4, 2.5)).toBe('player');
    expect(resolveDropOwner('rival', 2.6, 2.5)).toBe('player');
    expect(resolveDropOwner(null, 0, 2.5)).toBe('player');
  });

  it('rival AI freezes when stunned and naps during WATCHING or after WARNING reaction', () => {
    const items = [{ id: 1, x: 240, width: 32, baseScore: 60, dropped: false }];
    const stunned = decideRivalAction({
      rivalX: 120,
      rivalStunSec: 1.8,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items,
    });
    expect(stunned.stunned).toBe(true);
    expect(stunned.moveDir).toBe(0);

    const watching = decideRivalAction({
      rivalX: 120,
      rivalStunSec: 0,
      stewardPhase: 'WATCHING',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items,
    });
    expect(watching.napping).toBe(true);
    expect(watching.moveDir).toBe(0);

    const warningSlow = decideRivalAction({
      rivalX: 120,
      rivalStunSec: 0,
      stewardPhase: 'WARNING',
      reactionTimerSec: 0.3,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items,
    });
    expect(warningSlow.napping).toBe(false);
    expect(warningSlow.moveDir).toBe(1);
  });

  it('rival AI prioritizes higher-score / edge-close items and taps near edge', () => {
    const items = [
      { id: 1, x: 140, width: 30, baseScore: 25, dropped: false },
      { id: 2, x: 255, width: 36, baseScore: 120, dropped: false },
    ];
    const far = decideRivalAction({
      rivalX: 90,
      rivalStunSec: 0,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items,
    });
    expect(far.moveDir).toBe(1);
    expect(far.tap).toBe(false);

    // Near left edge of item #2 (255 - 18 = 237) -> rivalX = 210, paw = 244 (within 22px)
    const near = decideRivalAction({
      rivalX: 218,
      rivalStunSec: 0,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items,
    });
    expect(near.tap).toBe(true);
  });

  it('triggers Blame Shift when player naps cleanly and rival or rival-owned item violates WATCHING', () => {
    const res1 = evaluateVersusWatch({
      playerActive: false,
      rivalActive: true,
      movingOwners: [],
      droppedOwners: [],
      rivalStunSec: 0,
    });
    expect(res1.blameShifted).toBe(true);
    expect(res1.playerCaught).toBe(false);

    const res2 = evaluateVersusWatch({
      playerActive: false,
      rivalActive: false,
      movingOwners: ['rival'],
      droppedOwners: [],
      rivalStunSec: 0,
    });
    expect(res2.blameShifted).toBe(true);
    expect(res2.playerCaught).toBe(false);
  });

  it('catches player when player is active or player-owned item moves/drops during WATCHING', () => {
    expect(
      evaluateVersusWatch({
        playerActive: true,
        rivalActive: true,
        movingOwners: ['rival'],
        droppedOwners: [],
        rivalStunSec: 0,
      }),
    ).toEqual({ playerCaught: true, blameShifted: false });

    expect(
      evaluateVersusWatch({
        playerActive: false,
        rivalActive: false,
        movingOwners: ['player'],
        droppedOwners: [],
        rivalStunSec: 0,
      }),
    ).toEqual({ playerCaught: true, blameShifted: false });

    expect(
      evaluateVersusWatch({
        playerActive: false,
        rivalActive: false,
        movingOwners: [],
        droppedOwners: ['player'],
        rivalStunSec: 0,
      }),
    ).toEqual({ playerCaught: true, blameShifted: false });
  });

  it('does not blame-shift a rival that is already stunned', () => {
    const res = evaluateVersusWatch({
      playerActive: false,
      rivalActive: false,
      movingOwners: ['rival'],
      droppedOwners: [],
      rivalStunSec: 1.5,
    });
    expect(res).toEqual({ playerCaught: false, blameShifted: false });
  });

  it('evaluates versus outcome (win / lose / tie) and awards +40 bonus canCoins on win', () => {
    expect(evaluateVersusOutcome(240, 180)).toBe('win');
    expect(evaluateVersusOutcome(150, 220)).toBe('lose');
    expect(evaluateVersusOutcome(180, 180)).toBe('tie');

    const base = calculateCanCoinsReward({
      totalScore: 200,
      dropCount: 4,
      passedStory: false,
      stars: 0,
      difficulty: 'normal',
      versusWin: false,
    });
    const win = calculateCanCoinsReward({
      totalScore: 200,
      dropCount: 4,
      passedStory: false,
      stars: 0,
      difficulty: 'normal',
      versusWin: true,
    });
    expect(win - base).toBe(tuning.versus.winBonusCoins);
  });

  it('sanitizes and persists versusWins and blameShiftCount in ProgressionState', () => {
    const clean = sanitizeProgression({ versusWins: 5, blameShiftCount: 11, canCoins: 120 });
    expect(clean.versusWins).toBe(5);
    expect(clean.blameShiftCount).toBe(11);
    const fallback = sanitizeProgression({ versusWins: -3, blameShiftCount: 'bad' });
    expect(fallback.versusWins).toBe(0);
    expect(fallback.blameShiftCount).toBe(0);
  });

  it('rival AI walks left when overshooting target item and returns idle when no items left', () => {
    const resLeft = decideRivalAction({
      rivalX: 250,
      rivalStunSec: 0,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items: [{ id: 1, x: 180, width: 30, baseScore: 40, dropped: false }],
    });
    expect(resLeft.moveDir).toBe(-1);

    const resEmpty = decideRivalAction({
      rivalX: 120,
      rivalStunSec: 0,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items: [{ id: 1, x: 180, width: 30, baseScore: 40, dropped: true }],
    });
    expect(resEmpty).toEqual({ moveDir: 0, tap: false, napping: false, stunned: false });
  });

  it('rival AI naps on CAUGHT phase and respects tapCooldownSec', () => {
    const caught = decideRivalAction({
      rivalX: 180,
      rivalStunSec: 0,
      stewardPhase: 'CAUGHT',
      reactionTimerSec: 0,
      tapCooldownSec: 0,
      tableEdgeX: 300,
      pawReach: 34,
      items: [{ id: 1, x: 250, width: 30, baseScore: 60, dropped: false }],
    });
    expect(caught.napping).toBe(true);

    const onCooldown = decideRivalAction({
      rivalX: 218,
      rivalStunSec: 0,
      stewardPhase: 'RELAXED',
      reactionTimerSec: 0,
      tapCooldownSec: 0.4,
      tableEdgeX: 300,
      pawReach: 34,
      items: [{ id: 2, x: 255, width: 36, baseScore: 120, dropped: false }],
    });
    expect(onCooldown.tap).toBe(false);
  });

  it('triggers Blame Shift when rival-owned item drops during WATCHING while player naps', () => {
    const res = evaluateVersusWatch({
      playerActive: false,
      rivalActive: false,
      movingOwners: [],
      droppedOwners: ['rival'],
      rivalStunSec: 0,
    });
    expect(res).toEqual({ playerCaught: false, blameShifted: true });
  });

  it('freezes rival AI decisions while game is paused (shouldAdvanceSimulation=false)', () => {
    expect(shouldAdvanceSimulation('paused')).toBe(false);
    let rivalStun = 2.0;
    if (shouldAdvanceSimulation('paused')) {
      rivalStun = Math.max(0, rivalStun - 0.5);
    }
    expect(rivalStun).toBe(2.0);
  });

  it('awards +40 versusWin coins even on hard difficulty', () => {
    const lossCoins = calculateCanCoinsReward({
      totalScore: 300,
      dropCount: 5,
      passedStory: false,
      stars: 0,
      difficulty: 'hard',
      versusWin: false,
    });
    const winCoins = calculateCanCoinsReward({
      totalScore: 300,
      dropCount: 5,
      passedStory: false,
      stars: 0,
      difficulty: 'hard',
      versusWin: true,
    });
    expect(winCoins - lossCoins).toBe(40);
  });

  it('never marks caught-out (hearts_zero) as a versus win even if playerScore > rivalScore', () => {
    const caughtWin = evaluateVersusResult(500, 120, 'hearts_zero');
    expect(caughtWin.outcome).toBe('win');
    expect(caughtWin.isWin).toBe(false);

    const timeUpWin = evaluateVersusResult(500, 120, 'time_up');
    expect(timeUpWin.outcome).toBe('win');
    expect(timeUpWin.isWin).toBe(true);
  });

  it('adds greedy reaction delay when rival is pushing teeter or angry/shoved', () => {
    const calm = computeRivalWarningReactionSec(0.45, 0.68, 0.48, false, () => 0.5);
    const greedy = computeRivalWarningReactionSec(0.45, 0.68, 0.48, true, () => 0.5);
    expect(greedy - calm).toBeCloseTo(0.48, 4);
  });

  it('enforces ground horizontal anti-overlap separation between player and rival', () => {
    const sep = resolveCatGroundSeparation(120, 124, 46, 46, 290, 1);
    expect(sep.jostled).toBe(true);
    expect(Math.abs(sep.catX - sep.rivalX)).toBeGreaterThanOrEqual(45.9);

    const far = resolveCatGroundSeparation(80, 180, 46, 46, 290, 0);
    expect(far.jostled).toBe(false);
    expect(far.catX).toBe(80);
    expect(far.rivalX).toBe(180);
  });

  it('locks item ownership once item crosses tableEdgeX - 4 or drops below tableTopY + 12', () => {
    expect(isItemOwnershipLocked(260, 400, 300, 420)).toBe(false);
    expect(isItemOwnershipLocked(296, 420, 300, 420)).toBe(true);
    expect(isItemOwnershipLocked(250, 435, 300, 420)).toBe(true);
  });
});
