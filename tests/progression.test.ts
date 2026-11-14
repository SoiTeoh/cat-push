import { describe, expect, it } from 'vitest';
import {
  CAT_SKINS,
  CODEX_ENTRIES,
  CODEX_MASTER_REWARD_COINS,
} from '../src/config/progression';
import { tuning } from '../src/config/tuning';
import {
  calculateCanCoinsReward,
  countUnlockedCodex,
  createInitialProgression,
  getEffectiveStats,
  getUpgradeCost,
  purchaseOrEquipSkin,
  purchaseUpgrade,
  recordCodexDrops,
  sanitizeProgression,
} from '../src/game/progression';
import {
  calculateDropScore,
  createStewardState,
  recordItemDrop,
  stepSteward,
  triggerMeowCharm,
  type StewardState,
} from '../src/game/rules';
import { CatPushWorld } from '../src/game/world';

describe('CanCoins Wallet & Rewards (Phase B1)', () => {
  it('returns 0 coins when no items dropped or score is 0, and guarantees >= 1 coin when score > 0', () => {
    expect(
      calculateCanCoinsReward({
        totalScore: 0,
        dropCount: 0,
        passedStory: false,
        stars: 0,
        difficulty: 'easy',
      }),
    ).toBe(0);

    expect(
      calculateCanCoinsReward({
        totalScore: 5,
        dropCount: 1,
        passedStory: false,
        stars: 0,
        difficulty: 'easy',
      }),
    ).toBe(1);
  });

  it('applies story pass (+15), 3-star (+15), and difficulty multipliers (1.0 / 1.25 / 1.6)', () => {
    const easy3 = calculateCanCoinsReward({
      totalScore: 600,
      dropCount: 4,
      passedStory: true,
      stars: 3,
      difficulty: 'easy',
    });
    // base 60 + 15 + 15 = 90 * 1.0 = 90
    expect(easy3).toBe(90);

    const normal3 = calculateCanCoinsReward({
      totalScore: 600,
      dropCount: 4,
      passedStory: true,
      stars: 3,
      difficulty: 'normal',
    });
    // 90 * 1.25 = 112.5 -> 113
    expect(normal3).toBe(113);

    const hard3 = calculateCanCoinsReward({
      totalScore: 600,
      dropCount: 4,
      passedStory: true,
      stars: 3,
      difficulty: 'hard',
    });
    // 90 * 1.6 = 144
    expect(hard3).toBe(144);
  });
});

describe('Cat Upgrades Shop (Phase B1)', () => {
  it('purchases Lv.1 -> Lv.3 upgrades with 30/70/130 costs and blocks when insufficient or maxed', () => {
    let p = { ...createInitialProgression(), canCoins: 250 };
    expect(getUpgradeCost('pawPower', 0)).toBe(30);

    const r1 = purchaseUpgrade(p, 'pawPower');
    expect(r1.purchased).toBe(true);
    expect(r1.state.upgrades.pawPower).toBe(1);
    expect(r1.state.canCoins).toBe(220);

    const r2 = purchaseUpgrade(r1.state, 'pawPower');
    expect(r2.purchased).toBe(true);
    expect(r2.state.upgrades.pawPower).toBe(2);
    expect(r2.state.canCoins).toBe(150);

    const r3 = purchaseUpgrade(r2.state, 'pawPower');
    expect(r3.purchased).toBe(true);
    expect(r3.state.upgrades.pawPower).toBe(3);
    expect(r3.state.canCoins).toBe(20);

    // Maxed out -> blocked
    expect(getUpgradeCost('pawPower', 3)).toBeNull();
    const r4 = purchaseUpgrade(r3.state, 'pawPower');
    expect(r4.purchased).toBe(false);

    // Insufficient coins -> blocked
    const rLow = purchaseUpgrade(r3.state, 'actingSkill');
    expect(rLow.purchased).toBe(false);
    expect(rLow.state.upgrades.actingSkill).toBe(0);
  });

  it('computes effective stats for all 4 upgrades at Lv.3', () => {
    const p = {
      ...createInitialProgression(),
      upgrades: {
        pawPower: 3 as const,
        actingSkill: 3 as const,
        quietPaws: 3 as const,
        charmMaster: 3 as const,
      },
    };
    const stats = getEffectiveStats(p);
    expect(stats.pawMultiplier).toBeCloseTo(1.38, 4);
    expect(stats.warningBonusSec).toBeCloseTo(0.3, 4);
    expect(stats.noiseFactor).toBeCloseTo(0.62, 4);
    expect(stats.meowCooldownSec).toBeCloseTo(5.5, 4);
  });

  it('applies actingSkill warningBonusSec in stepSteward and charmMaster cooldown in triggerMeowCharm', () => {
    let s: StewardState = {
      ...createStewardState(tuning, 'normal'),
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
        warningBonusSec: 0.3,
      },
      tuning,
    );
    expect(s.phase).toBe('WARNING');
    expect(s.phaseTimerSec).toBeCloseTo(tuning.difficulties.normal.warningDurationSec + 0.3, 4);

    const charm = triggerMeowCharm(s, tuning, 5.5, 0.3);
    expect(charm.triggered).toBe(true);
    expect(charm.state.meowCooldownSec).toBeCloseTo(5.5, 4);
    expect(charm.state.charmedTimerSec).toBeCloseTo(tuning.cat.meowCharmDurationSec + 0.3, 4);
  });
});

describe('Cat Skins & Perks (Phase B1)', () => {
  it('blocks skin purchase when coins are insufficient and unlocks/equips when affordable', () => {
    let p = { ...createInitialProgression(), canCoins: 70 };
    const fail = purchaseOrEquipSkin(p, 'cow');
    expect(fail.changed).toBe(false);
    expect(fail.bought).toBe(false);

    p = { ...p, canCoins: 100 };
    const buy = purchaseOrEquipSkin(p, 'cow');
    expect(buy.changed).toBe(true);
    expect(buy.bought).toBe(true);
    expect(buy.state.canCoins).toBe(100 - CAT_SKINS.cow.cost);
    expect(buy.state.unlockedSkins).toContain('cow');
    expect(buy.state.equippedSkin).toBe('cow');

    // Re-equipping orange is free
    const equipOrange = purchaseOrEquipSkin(buy.state, 'orange');
    expect(equipOrange.changed).toBe(true);
    expect(equipOrange.bought).toBe(false);
    expect(equipOrange.state.canCoins).toBe(buy.state.canCoins);
  });

  it('applies cow (+10% teeter score), siamese (+0.3s meow), and black (+10% heavy speed) perks', () => {
    const cowStats = getEffectiveStats({ ...createInitialProgression(), equippedSkin: 'cow' });
    expect(cowStats.teeterScoreMultiplier).toBeCloseTo(1.1, 4);
    expect(calculateDropScore('mug', 2, false, tuning, cowStats.teeterScoreMultiplier)).toBe(
      Math.round(tuning.items.mug.baseScore * 2 * 1.1),
    );
    // Safe ×1 drop does NOT get teeter bonus
    expect(calculateDropScore('mug', 1, false, tuning, cowStats.teeterScoreMultiplier)).toBe(
      tuning.items.mug.baseScore,
    );

    const siameseStats = getEffectiveStats({
      ...createInitialProgression(),
      equippedSkin: 'siamese',
    });
    expect(siameseStats.meowCharmBonusSec).toBeCloseTo(0.3, 4);

    const blackStats = getEffectiveStats({ ...createInitialProgression(), equippedSkin: 'black' });
    expect(blackStats.heavySpeedMultiplier).toBeCloseTo(1.1, 4);
  });
});

describe('15-Item Destruction Codex & Migration (Phase B1)', () => {
  it('defines all 15 unique items with non-empty hints and humorous roasts', () => {
    expect(CODEX_ENTRIES).toHaveLength(15);
    const kinds = new Set(CODEX_ENTRIES.map((e) => e.kind));
    expect(kinds.size).toBe(15);
    for (const entry of CODEX_ENTRIES) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.stageHint.length).toBeGreaterThan(0);
      expect(entry.roast.length).toBeGreaterThan(4);
    }
  });

  it('unlocks codex entries, tracks dropCount and bestMultiplier, and awards +100 coins once at 15/15', () => {
    let p = createInitialProgression();
    expect(countUnlockedCodex(p)).toBe(0);

    // Drop 14 distinct items first
    const first14 = CODEX_ENTRIES.slice(0, 14).map((e) => ({
      kind: e.kind,
      multiplier: 2 as const,
      score: 100,
      brokeOnTable: false,
    }));
    const r1 = recordCodexDrops(p, first14);
    expect(r1.newlyCompletedCodex).toBe(false);
    expect(countUnlockedCodex(r1.state)).toBe(14);
    expect(r1.state.canCoins).toBe(0);

    // Drop the 15th item with ×3 -> completes 15/15 and awards +100 coins!
    const r2 = recordCodexDrops(r1.state, [
      { kind: CODEX_ENTRIES[14].kind, multiplier: 3, score: 300, brokeOnTable: false },
    ]);
    expect(r2.newlyCompletedCodex).toBe(true);
    expect(countUnlockedCodex(r2.state)).toBe(15);
    expect(r2.state.codexMasterClaimed).toBe(true);
    expect(r2.state.canCoins).toBe(CODEX_MASTER_REWARD_COINS);
    expect(r2.state.codex[CODEX_ENTRIES[14].kind].bestMultiplier).toBe(3);

    // Dropping again does NOT re-award +100 coins
    const r3 = recordCodexDrops(r2.state, [
      { kind: CODEX_ENTRIES[0].kind, multiplier: 3, score: 30, brokeOnTable: false },
    ]);
    expect(r3.newlyCompletedCodex).toBe(false);
    expect(r3.state.canCoins).toBe(CODEX_MASTER_REWARD_COINS);
    expect(r3.state.codex[CODEX_ENTRIES[0].kind].dropCount).toBe(2);
    expect(r3.state.codex[CODEX_ENTRIES[0].kind].bestMultiplier).toBe(3);
  });

  it('safely sanitizes and migrates corrupted or partial progression data', () => {
    const fromNull = sanitizeProgression(null);
    expect(fromNull.canCoins).toBe(0);
    expect(fromNull.equippedSkin).toBe('orange');
    expect(countUnlockedCodex(fromNull)).toBe(0);

    const partial = sanitizeProgression({
      canCoins: 185,
      upgrades: { pawPower: 2, actingSkill: 99 },
      unlockedSkins: ['orange', 'cow', 'invalid_skin'],
      equippedSkin: 'cow',
      codex: {
        kettle: { unlocked: true, dropCount: 4, bestMultiplier: 3 },
      },
    });
    expect(partial.canCoins).toBe(185);
    expect(partial.upgrades.pawPower).toBe(2);
    expect(partial.upgrades.actingSkill).toBe(3); // clamped to 3
    expect(partial.equippedSkin).toBe('cow');
    expect(partial.unlockedSkins).toEqual(['orange', 'cow']);
    expect(partial.codex.kettle.dropCount).toBe(4);
    expect(partial.codex.kettle.bestMultiplier).toBe(3);
  });
});

describe('BillSummary with Skin Multiplier (Phase B1)', () => {
  it('records cow skin +10% teeter bonus into BillSummary accurately', () => {
    let bill = recordItemDrop(
      {
        totalScore: 0,
        counts: {
          tissue: 0,
          pen: 0,
          mug: 0,
          kettle: 0,
          mouse: 0,
          ink: 0,
          phone: 0,
          keyboard: 0,
          lipstick: 0,
          compact: 0,
          perfume: 0,
          mirror: 0,
          remote: 0,
          wineglass: 0,
          fishbowl: 0,
        },
        teeterDrops: 0,
        extremeTeeterDrops: 0,
        damagedDrops: 0,
        records: [],
      },
      'kettle',
      3,
      tuning,
      false,
      1.1,
    );
    expect(bill.totalScore).toBe(Math.round(tuning.items.kettle.baseScore * 3 * 1.1));
    expect(bill.extremeTeeterDrops).toBe(1);
  });

  it('tracks charmMaster cooldown progression 9.0 -> 7.8 -> 6.6 -> 5.5 across Lv.0..3', () => {
    let p = { ...createInitialProgression(), canCoins: 300 };
    expect(getEffectiveStats(p).meowCooldownSec).toBeCloseTo(9.0, 4);
    p = purchaseUpgrade(p, 'charmMaster').state;
    expect(getEffectiveStats(p).meowCooldownSec).toBeCloseTo(7.8, 4);
    p = purchaseUpgrade(p, 'charmMaster').state;
    expect(getEffectiveStats(p).meowCooldownSec).toBeCloseTo(6.6, 4);
    p = purchaseUpgrade(p, 'charmMaster').state;
    expect(getEffectiveStats(p).meowCooldownSec).toBeCloseTo(5.5, 4);
  });

  it('reduces addedNoise in CatPushWorld.step when quietPaws noiseFactor < 1', () => {
    const w1 = new CatPushWorld(tuning, ['tissue']);
    const r1 = w1.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, { noiseFactor: 1 });
    const w2 = new CatPushWorld(tuning, ['tissue']);
    const r2 = w2.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, {
      noiseFactor: 0.62,
    });
    expect(r2.addedNoise).toBeCloseTo(r1.addedNoise * 0.62, 4);
  });

  it('boosts tap impulse in CatPushWorld.step when pawPower pawMultiplier > 1', () => {
    const w1 = new CatPushWorld(tuning, ['mug']);
    const m1 = w1.items[0];
    w1.cat.x = m1.body.position.x - m1.spec.width / 2 - 12;
    w1.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, { pawMultiplier: 1 });

    const w2 = new CatPushWorld(tuning, ['mug']);
    const m2 = w2.items[0];
    w2.cat.x = m2.body.position.x - m2.spec.width / 2 - 12;
    w2.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, { pawMultiplier: 1.38 });

    expect(m2.body.velocity.x).toBeGreaterThan(m1.body.velocity.x);
  });

  it('boosts heavy item tap speed with black skin heavySpeedMultiplier = 1.1', () => {
    const w1 = new CatPushWorld(tuning, ['kettle']);
    const k1 = w1.items[0];
    w1.cat.x = k1.body.position.x - k1.spec.width / 2 - 12;
    w1.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, {
      heavySpeedMultiplier: 1,
    });

    const w2 = new CatPushWorld(tuning, ['kettle']);
    const k2 = w2.items[0];
    w2.cat.x = k2.body.position.x - k2.spec.width / 2 - 12;
    w2.step(0, true, false, tuning.loop.fixedDtMs, 'easy', undefined, {
      heavySpeedMultiplier: 1.1,
    });

    expect(k2.body.velocity.x).toBeGreaterThan(k1.body.velocity.x);
  });

  it('falls back equippedSkin to orange when persisted equippedSkin is not unlocked', () => {
    const sanitized = sanitizeProgression({
      unlockedSkins: ['orange'],
      equippedSkin: 'black',
    });
    expect(sanitized.equippedSkin).toBe('orange');
  });
});
