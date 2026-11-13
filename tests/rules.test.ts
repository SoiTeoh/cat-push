import { describe, expect, it } from 'vitest';
import { tuning } from '../src/config/tuning';
import {
  computeRelaxedInterval,
  createBillSummary,
  createStewardState,
  evaluateTeeterState,
  recordItemDrop,
  stepSteward,
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

  it('recovers from CAUGHT to RELAXED after caughtFreezeSec when hearts remain', () => {
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
});

describe('recordItemDrop & createBillSummary', () => {
  it('accumulates base scores, multipliers, and teeter counts accurately', () => {
    let bill = createBillSummary();
    expect(bill.totalScore).toBe(0);

    bill = recordItemDrop(bill, 'tissue', 1, tuning); // +10
    bill = recordItemDrop(bill, 'pen', 2, tuning); // +60, teeterDrops=1
    bill = recordItemDrop(bill, 'mug', 3, tuning); // +240, teeterDrops=2, extreme=1
    bill = recordItemDrop(bill, 'kettle', 1, tuning); // +300

    expect(bill.totalScore).toBe(10 + 60 + 240 + 300);
    expect(bill.counts).toEqual({ tissue: 1, pen: 1, mug: 1, kettle: 1 });
    expect(bill.teeterDrops).toBe(2);
    expect(bill.extremeTeeterDrops).toBe(1);
    expect(bill.records).toHaveLength(4);
  });
});
