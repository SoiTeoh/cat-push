import {
  CAT_SKINS,
  CODEX_ENTRIES,
  CODEX_MASTER_REWARD_COINS,
  UPGRADE_SPECS,
  type CatSkinId,
  type UpgradeId,
} from '../config/progression';
import type { DifficultyMode, ItemKind } from '../config/tuning';
import type { DropRecord } from './rules';

export interface CodexItemRecord {
  readonly unlocked: boolean;
  readonly dropCount: number;
  readonly bestMultiplier: 0 | 1 | 2 | 3;
}

export interface ProgressionState {
  readonly canCoins: number;
  readonly upgrades: Record<UpgradeId, 0 | 1 | 2 | 3>;
  readonly unlockedSkins: readonly CatSkinId[];
  readonly equippedSkin: CatSkinId;
  readonly codex: Record<ItemKind, CodexItemRecord>;
  readonly codexMasterClaimed: boolean;
  readonly versusWins: number;
  readonly blameShiftCount: number;
}

export interface EffectiveStats {
  readonly pawMultiplier: number;
  readonly warningBonusSec: number;
  readonly noiseFactor: number;
  readonly meowCooldownSec: number;
  readonly teeterScoreMultiplier: number;
  readonly meowCharmBonusSec: number;
  readonly heavySpeedMultiplier: number;
}

export interface CanCoinsInput {
  readonly totalScore: number;
  readonly dropCount: number;
  readonly passedStory: boolean;
  readonly stars: 0 | 1 | 2 | 3;
  readonly difficulty: DifficultyMode;
  readonly versusWin?: boolean;
}

const DIFFICULTY_COIN_MULTIPLIER: Record<DifficultyMode, number> = {
  easy: 1.0,
  normal: 1.25,
  hard: 1.6,
};

export function createInitialCodex(): Record<ItemKind, CodexItemRecord> {
  const map = {} as Record<ItemKind, CodexItemRecord>;
  for (const entry of CODEX_ENTRIES) {
    map[entry.kind] = { unlocked: false, dropCount: 0, bestMultiplier: 0 };
  }
  return map;
}

export function createInitialProgression(): ProgressionState {
  return {
    canCoins: 0,
    upgrades: {
      pawPower: 0,
      actingSkill: 0,
      quietPaws: 0,
      charmMaster: 0,
    },
    unlockedSkins: ['orange'],
    equippedSkin: 'orange',
    codex: createInitialCodex(),
    codexMasterClaimed: false,
    versusWins: 0,
    blameShiftCount: 0,
  };
}

/**
 * 结算局外罐头币奖励：
 * - 未推落任何物品或赔偿为 0 时得 0 币；
 * - 有赔偿时基础币 = Math.max(1, Math.floor(totalScore / 10))；
 * - 闯关成功 +15 币，三星额外 +15 币；
 * - 再乘以难度倍率（easy 1.0 / normal 1.25 / hard 1.6），双猫胜出额外 +40 币。
 */
export function calculateCanCoinsReward(input: CanCoinsInput): number {
  const winBonus = input.versusWin ? 40 : 0;
  if (input.totalScore <= 0 || input.dropCount <= 0) {
    return winBonus;
  }
  const baseCoins = Math.max(1, Math.floor(input.totalScore / 10));
  const passBonus = input.passedStory ? 15 : 0;
  const starBonus = input.passedStory && input.stars === 3 ? 15 : 0;
  const mult = DIFFICULTY_COIN_MULTIPLIER[input.difficulty];
  return Math.max(1, Math.round((baseCoins + passBonus + starBonus) * mult)) + winBonus;
}

export function getUpgradeCost(upgradeId: UpgradeId, currentLevel: 0 | 1 | 2 | 3): number | null {
  if (currentLevel === 0) return UPGRADE_SPECS[upgradeId].costs[0];
  if (currentLevel === 1) return UPGRADE_SPECS[upgradeId].costs[1];
  if (currentLevel === 2) return UPGRADE_SPECS[upgradeId].costs[2];
  return null;
}

export function purchaseUpgrade(
  state: ProgressionState,
  upgradeId: UpgradeId,
): { readonly state: ProgressionState; readonly purchased: boolean } {
  const curLv = state.upgrades[upgradeId];
  const cost = getUpgradeCost(upgradeId, curLv);
  if (cost === null || state.canCoins < cost) {
    return { state, purchased: false };
  }
  return {
    purchased: true,
    state: {
      ...state,
      canCoins: state.canCoins - cost,
      upgrades: {
        ...state.upgrades,
        [upgradeId]: (curLv + 1) as 0 | 1 | 2 | 3,
      },
    },
  };
}

export function purchaseOrEquipSkin(
  state: ProgressionState,
  skinId: CatSkinId,
): { readonly state: ProgressionState; readonly changed: boolean; readonly bought: boolean } {
  if (state.unlockedSkins.includes(skinId)) {
    if (state.equippedSkin === skinId) {
      return { state, changed: false, bought: false };
    }
    return {
      changed: true,
      bought: false,
      state: {
        ...state,
        equippedSkin: skinId,
      },
    };
  }

  const spec = CAT_SKINS[skinId];
  if (state.canCoins < spec.cost) {
    return { state, changed: false, bought: false };
  }
  return {
    changed: true,
    bought: true,
    state: {
      ...state,
      canCoins: state.canCoins - spec.cost,
      unlockedSkins: [...state.unlockedSkins, skinId],
      equippedSkin: skinId,
    },
  };
}

export function countUnlockedCodex(state: ProgressionState): number {
  let count = 0;
  for (const entry of CODEX_ENTRIES) {
    if (state.codex[entry.kind]?.unlocked) count += 1;
  }
  return count;
}

export function recordCodexDrops(
  state: ProgressionState,
  records: readonly DropRecord[],
): { readonly state: ProgressionState; readonly newlyCompletedCodex: boolean } {
  if (records.length === 0) {
    return { state, newlyCompletedCodex: false };
  }

  const nextCodex: Record<ItemKind, CodexItemRecord> = { ...state.codex };
  for (const rec of records) {
    const prev = nextCodex[rec.kind] ?? { unlocked: false, dropCount: 0, bestMultiplier: 0 };
    const nextBest = Math.max(prev.bestMultiplier, rec.multiplier) as 0 | 1 | 2 | 3;
    nextCodex[rec.kind] = {
      unlocked: true,
      dropCount: prev.dropCount + 1,
      bestMultiplier: nextBest,
    };
  }

  let unlockedCount = 0;
  for (const entry of CODEX_ENTRIES) {
    if (nextCodex[entry.kind]?.unlocked) unlockedCount += 1;
  }

  const newlyCompletedCodex = unlockedCount === CODEX_ENTRIES.length && !state.codexMasterClaimed;
  return {
    newlyCompletedCodex,
    state: {
      ...state,
      codex: nextCodex,
      codexMasterClaimed: state.codexMasterClaimed || newlyCompletedCodex,
      canCoins: state.canCoins + (newlyCompletedCodex ? CODEX_MASTER_REWARD_COINS : 0),
    },
  };
}

export function getEffectiveStats(state: ProgressionState): EffectiveStats {
  const pawBonus = UPGRADE_SPECS.pawPower.values[state.upgrades.pawPower];
  const warningBonusSec = UPGRADE_SPECS.actingSkill.values[state.upgrades.actingSkill];
  const noiseReduction = UPGRADE_SPECS.quietPaws.values[state.upgrades.quietPaws];
  const meowCooldownSec = UPGRADE_SPECS.charmMaster.values[state.upgrades.charmMaster];
  const skin = CAT_SKINS[state.equippedSkin] ?? CAT_SKINS.orange;

  return {
    pawMultiplier: 1 + pawBonus,
    warningBonusSec,
    noiseFactor: Math.max(0.2, 1 - noiseReduction),
    meowCooldownSec,
    teeterScoreMultiplier: skin.teeterScoreMultiplier,
    meowCharmBonusSec: skin.meowCharmBonusSec,
    heavySpeedMultiplier: skin.heavySpeedMultiplier,
  };
}

function clampUpgradeLevel(val: unknown): 0 | 1 | 2 | 3 {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  if (val >= 3) return 3;
  if (val >= 2) return 2;
  if (val >= 1) return 1;
  return 0;
}

export function sanitizeProgression(raw: unknown): ProgressionState {
  const base = createInitialProgression();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Partial<ProgressionState>;

  const unlockedSet = new Set<CatSkinId>(['orange']);
  if (Array.isArray(obj.unlockedSkins)) {
    for (const s of obj.unlockedSkins) {
      if (s === 'orange' || s === 'cow' || s === 'siamese' || s === 'black') {
        unlockedSet.add(s);
      }
    }
  }
  const equippedSkin: CatSkinId =
    obj.equippedSkin && unlockedSet.has(obj.equippedSkin) ? obj.equippedSkin : 'orange';

  const codex = createInitialCodex();
  if (obj.codex && typeof obj.codex === 'object') {
    for (const entry of CODEX_ENTRIES) {
      const rec = (obj.codex as Partial<Record<ItemKind, Partial<CodexItemRecord>>>)[entry.kind];
      if (rec && typeof rec === 'object') {
        const dropCount =
          typeof rec.dropCount === 'number' && rec.dropCount > 0 ? Math.floor(rec.dropCount) : 0;
        const bestMult =
          rec.bestMultiplier === 3
            ? 3
            : rec.bestMultiplier === 2
              ? 2
              : rec.bestMultiplier === 1
                ? 1
                : 0;
        codex[entry.kind] = {
          unlocked: Boolean(rec.unlocked) || dropCount > 0,
          dropCount,
          bestMultiplier: bestMult,
        };
      }
    }
  }

  return {
    canCoins:
      typeof obj.canCoins === 'number' && Number.isFinite(obj.canCoins) && obj.canCoins > 0
        ? Math.floor(obj.canCoins)
        : 0,
    upgrades: {
      pawPower: clampUpgradeLevel(obj.upgrades?.pawPower),
      actingSkill: clampUpgradeLevel(obj.upgrades?.actingSkill),
      quietPaws: clampUpgradeLevel(obj.upgrades?.quietPaws),
      charmMaster: clampUpgradeLevel(obj.upgrades?.charmMaster),
    },
    unlockedSkins: Array.from(unlockedSet),
    equippedSkin,
    codex,
    codexMasterClaimed: Boolean(obj.codexMasterClaimed),
    versusWins:
      typeof obj.versusWins === 'number' && Number.isFinite(obj.versusWins) && obj.versusWins > 0
        ? Math.floor(obj.versusWins)
        : 0,
    blameShiftCount:
      typeof obj.blameShiftCount === 'number' &&
      Number.isFinite(obj.blameShiftCount) &&
      obj.blameShiftCount > 0
        ? Math.floor(obj.blameShiftCount)
        : 0,
  };
}
