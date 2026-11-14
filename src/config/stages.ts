import type { ItemKind } from './tuning';

export type StageId = 1 | 2 | 3 | 4;
export type GameMode = 'story' | 'endless';

export interface StagePalette {
  readonly wallTop: string;
  readonly wallBottom: string;
  readonly tableTop: string;
  readonly tableEdgeShade: string;
  readonly tableBorder: string;
  readonly tableLeg: string;
  readonly floor: string;
  readonly accent: string;
}

export interface StageConfig {
  readonly id: StageId;
  readonly name: string;
  readonly shortName: string;
  readonly subtitle: string;
  readonly targetScore: number;
  readonly items: readonly ItemKind[];
  readonly enableTeeterSuspicion: boolean;
  readonly palette: StagePalette;
}

export const STAGES: Record<StageId, StageConfig> = {
  1: {
    id: 1,
    name: 'Stage 1：早茶厨房台',
    shortName: '1.厨房',
    subtitle: '暖白台面 · 推翻电水壶',
    targetScore: 300,
    items: ['kettle', 'mug', 'pen', 'tissue'],
    enableTeeterSuspicion: false,
    palette: {
      wallTop: '#f7efe3',
      wallBottom: '#eadbc8',
      tableTop: '#fcfaf6',
      tableEdgeShade: '#e7dfd5',
      tableBorder: '#cbbba8',
      tableLeg: '#c59b76',
      floor: '#8b6a4e',
      accent: '#e07040',
    },
  },
  2: {
    id: 2,
    name: 'Stage 2：打工人书房桌',
    shortName: '2.书房',
    subtitle: '原木桌面 · 提防震动手机',
    targetScore: 550,
    items: ['keyboard', 'phone', 'ink', 'mouse'],
    enableTeeterSuspicion: true,
    palette: {
      wallTop: '#e8eef5',
      wallBottom: '#d6e0eb',
      tableTop: '#d9ad7c',
      tableEdgeShade: '#ba8956',
      tableBorder: '#9b6b3e',
      tableLeg: '#734b28',
      floor: '#5d4a3d',
      accent: '#2563eb',
    },
  },
  3: {
    id: 3,
    name: 'Stage 3：精致化妆台',
    shortName: '3.化妆台',
    subtitle: '粉大理石 · 香水别在桌上摔',
    targetScore: 800,
    items: ['mirror', 'perfume', 'compact', 'lipstick'],
    enableTeeterSuspicion: true,
    palette: {
      wallTop: '#fdf0f5',
      wallBottom: '#f7dce6',
      tableTop: '#fae6ee',
      tableEdgeShade: '#eac5d4',
      tableBorder: '#d6a4b8',
      tableLeg: '#c48ea3',
      floor: '#8a6875',
      accent: '#db2777',
    },
  },
  4: {
    id: 4,
    name: 'Stage 4：客厅茶几终极战',
    shortName: '4.茶几',
    subtitle: '深胡桃木 · 推翻金鱼缸',
    targetScore: 1100,
    items: ['fishbowl', 'wineglass', 'remote', 'mug'],
    enableTeeterSuspicion: true,
    palette: {
      wallTop: '#ebe6df',
      wallBottom: '#d6cec2',
      tableTop: '#6b4735',
      tableEdgeShade: '#4f3224',
      tableBorder: '#3b2419',
      tableLeg: '#321e14',
      floor: '#4c4039',
      accent: '#b45309',
    },
  },
};

export const STAGE_IDS: readonly StageId[] = [1, 2, 3, 4];
