import type { ItemKind } from './tuning';

export type UpgradeId = 'pawPower' | 'actingSkill' | 'quietPaws' | 'charmMaster';

export interface UpgradeSpec {
  readonly id: UpgradeId;
  readonly name: string;
  readonly shortDesc: string;
  readonly costs: readonly [number, number, number];
  readonly values: readonly [number, number, number, number];
  readonly formatValue: (val: number) => string;
}

export const UPGRADE_IDS: readonly UpgradeId[] = [
  'pawPower',
  'actingSkill',
  'quietPaws',
  'charmMaster',
];

export const UPGRADE_SPECS: Record<UpgradeId, UpgradeSpec> = {
  pawPower: {
    id: 'pawPower',
    name: '大力金刚爪',
    shortDesc: '提升水平推力与轻拍冲量',
    costs: [30, 70, 130],
    values: [0, 0.12, 0.24, 0.38],
    formatValue: (v) => `+${Math.round(v * 100)}% 推力`,
  },
  actingSkill: {
    id: 'actingSkill',
    name: '奥斯卡演技',
    shortDesc: '延长主人 ? 预警反应窗口',
    costs: [30, 70, 130],
    values: [0, 0.1, 0.2, 0.3],
    formatValue: (v) => `+${v.toFixed(2)}s 预警`,
  },
  quietPaws: {
    id: 'quietPaws',
    name: '无影肉垫',
    shortDesc: '降低推物摩擦噪声累计速度',
    costs: [30, 70, 130],
    values: [0, 0.14, 0.26, 0.38],
    formatValue: (v) => `-${Math.round(v * 100)}% 噪声`,
  },
  charmMaster: {
    id: 'charmMaster',
    name: '猫语十级',
    shortDesc: '缩短 喵~ (E) 技能冷却时间',
    costs: [30, 70, 130],
    values: [9.0, 7.8, 6.6, 5.5],
    formatValue: (v) => `${v.toFixed(1)}s 冷却`,
  },
};

export type CatSkinId = 'orange' | 'cow' | 'siamese' | 'black';

export interface CatSkinSpec {
  readonly id: CatSkinId;
  readonly name: string;
  readonly cost: number;
  readonly perkDesc: string;
  readonly teeterScoreMultiplier: number;
  readonly meowCharmBonusSec: number;
  readonly heavySpeedMultiplier: number;
}

export const CAT_SKIN_IDS: readonly CatSkinId[] = ['orange', 'cow', 'siamese', 'black'];

export const CAT_SKINS: Record<CatSkinId, CatSkinSpec> = {
  orange: {
    id: 'orange',
    name: '肥橘猫',
    cost: 0,
    perkDesc: '经典橘白条纹 · 初心本色',
    teeterScoreMultiplier: 1,
    meowCharmBonusSec: 0,
    heavySpeedMultiplier: 1,
  },
  cow: {
    id: 'cow',
    name: '奶牛拆家猫',
    cost: 80,
    perkDesc: '黑白斑块小领结 · 悬边 ×2/×3 额外 +10% 赔偿',
    teeterScoreMultiplier: 1.1,
    meowCharmBonusSec: 0,
    heavySpeedMultiplier: 1,
  },
  siamese: {
    id: 'siamese',
    name: '挖煤暹罗猫',
    cost: 140,
    perkDesc: '奶油身黑脸冰蓝瞳 · 喵~ 打断时长 +0.3s',
    teeterScoreMultiplier: 1,
    meowCharmBonusSec: 0.3,
    heavySpeedMultiplier: 1,
  },
  black: {
    id: 'black',
    name: '黑猫战神',
    cost: 220,
    perkDesc: '纯黑金徽金瞳 · 重物推动速度 +10%',
    teeterScoreMultiplier: 1,
    meowCharmBonusSec: 0,
    heavySpeedMultiplier: 1.1,
  },
};

export interface CodexEntrySpec {
  readonly kind: ItemKind;
  readonly name: string;
  readonly stageHint: string;
  readonly roast: string;
}

export const CODEX_ENTRIES: readonly CodexEntrySpec[] = [
  {
    kind: 'tissue',
    name: '纸巾团',
    stageHint: '提示：第 1 关厨房台',
    roast: '抽纸？那是本喵免费的雪花制造机！',
  },
  {
    kind: 'pen',
    name: '圆珠笔',
    stageHint: '提示：第 1 关厨房台 / 第 2 关书桌',
    roast: '滚来滚去怪谁咯，桌沿自己长在那里！',
  },
  {
    kind: 'mug',
    name: '陶瓷马克杯',
    stageHint: '提示：第 1 关厨房台',
    roast: '里面还有半杯隔夜美式，我替你倒了~',
  },
  {
    kind: 'kettle',
    name: '电水壶',
    stageHint: '提示：第 1 关厨房台 / 无尽茶水间',
    roast: '吨位冠军，摔下去震动了整栋楼！',
  },
  {
    kind: 'mouse',
    name: '无线鼠标',
    stageHint: '提示：第 2 关打工人书桌',
    roast: '它叫“老鼠”耶，本喵按天性出爪很合理吧？',
  },
  {
    kind: 'ink',
    name: '墨水瓶',
    stageHint: '提示：第 2 关打工人书桌',
    roast: '纯黑墨水泼地毯，抽象派艺术大师就是我！',
  },
  {
    kind: 'phone',
    name: '震动手机',
    stageHint: '提示：第 2 关打工人书桌',
    roast: '你自己震下去的，跟我橘猫有什么关系？',
  },
  {
    kind: 'keyboard',
    name: '机械键盘',
    stageHint: '提示：第 2 关打工人书桌',
    roast: '踩一串乱码发给老板，今天提前下班！',
  },
  {
    kind: 'lipstick',
    name: '圆柱口红',
    stageHint: '提示：第 3 关少女化妆台',
    roast: '斩男色？先斩本喵一爪再说！',
  },
  {
    kind: 'compact',
    name: '散粉盒',
    stageHint: '提示：第 3 关少女化妆台',
    roast: '粉饼碎成满地星辰，主人你看多闪亮！',
  },
  {
    kind: 'perfume',
    name: '香水瓶',
    stageHint: '提示：第 3 关少女化妆台',
    roast: '香喷喷玻璃瓶，在桌边晃两秒再摔才够味！',
  },
  {
    kind: 'mirror',
    name: '化妆镜',
    stageHint: '提示：第 3 关少女化妆台',
    roast: '镜子里那只肥猫是谁？先把镜子推下去！',
  },
  {
    kind: 'remote',
    name: '遥控器',
    stageHint: '提示：第 4 关总裁客厅茶几',
    roast: '总和我抢沙发关注度，下去冷静冷静！',
  },
  {
    kind: 'wineglass',
    name: '高脚红酒杯',
    stageHint: '提示：第 4 关总裁客厅茶几',
    roast: '高脚杯摇摇晃晃的，不推一下都对不起物理！',
  },
  {
    kind: 'fishbowl',
    name: '金鱼缸',
    stageHint: '提示：第 4 关总裁客厅茶几',
    roast: '别怕小金鱼，地板大海更宽广！',
  },
];

export const CODEX_MASTER_REWARD_COINS = 100;
export const CODEX_MASTER_BADGE_NAME = '全屋碎裂大师';
