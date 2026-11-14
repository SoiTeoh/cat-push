import { describe, expect, it } from 'vitest';
import { STAGES, STAGE_IDS } from '../src/config/stages';
import { tuning } from '../src/config/tuning';
import {
  applyStageResult,
  buildWaveLayout,
  calculateDropScore,
  computeRelaxedInterval,
  createBillSummary,
  createInitialProgress,
  createStewardState,
  evaluateStageStars,
  evaluateTeeterState,
  isFragileBrokenOnTable,
  recordItemDrop,
  stepPhoneBuzz,
  stepSteward,
  type StewardState,
} from '../src/game/rules';

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
    expect(at100).toBeCloseTo(tuning.steward.minRelaxedSec, 4);
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

  it('unlocks next stage and preserves best star & score in StageProgress', () => {
    let p = createInitialProgress();
    p = applyStageResult(p, 1, 350, 2);
    expect(p.unlockedStage).toBe(2);
    expect(p.stars[1]).toBe(2);
    expect(p.bestScores[1]).toBe(350);

    // Replaying with lower stars keeps higher star record
    p = applyStageResult(p, 1, 310, 1);
    expect(p.stars[1]).toBe(2);
    expect(p.bestScores[1]).toBe(350);
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
