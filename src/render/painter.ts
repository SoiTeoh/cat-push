import { STAGES, STAGE_IDS, type GameMode, type StageConfig, type StageId } from '../config/stages';
import { tuning, type DifficultyMode, type Tuning } from '../config/tuning';
import {
  clamp,
  formatRestoreText,
  formatTeeterSuspicionText,
  type BillSummary,
  type StageProgress,
  type StewardState,
} from '../game/rules';
import type { CatPushWorld, TableItem } from '../game/world';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface RenderExtra {
  readonly screenMode: 'title' | 'playing' | 'result';
  readonly gameMode: GameMode;
  readonly difficulty: DifficultyMode;
  readonly stageId: StageId;
  readonly progress: StageProgress;
  readonly steward: StewardState;
  readonly bill: BillSummary;
  readonly muted: boolean;
  readonly debug: boolean;
  readonly shakeX: number;
  readonly shakeY: number;
  readonly particles: readonly Particle[];
  readonly floats: readonly FloatingText[];
  readonly animTimeSec: number;
}

export function drawGameFrame(
  ctx: CanvasRenderingContext2D,
  world: CatPushWorld,
  extra: RenderExtra,
  t: Tuning = tuning,
): void {
  const { width, height } = t.view;
  const { tableTopY, tableEdgeX, tableThickness, floorY } = t.scene;
  const stage = STAGES[extra.stageId];

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(extra.shakeX, extra.shakeY);

  // 1. 主题房间背景与地板
  drawRoomBackground(ctx, width, height, tableTopY, floorY, stage);

  // 2. 背景监控区：铲屎官（含分心窗口 & 悬边怀疑气泡）
  drawSteward(ctx, extra.steward, tableTopY, extra.animTimeSec);

  // 3. 主题桌面 + 清晰右桌沿 + 物品原位虚线底座
  drawTable(ctx, width, tableTopY, tableEdgeX, tableThickness, floorY, stage);
  drawOriginBases(ctx, world.items, tableTopY);

  // 4. 桌面物品
  for (const item of world.items) {
    if (item.dropped) continue;
    drawItem(ctx, item, tableEdgeX, extra.animTimeSec);
  }

  // 4.5 主人“物归原位”伸手拉锯动画
  if (extra.steward.phase === 'WATCHING' && extra.steward.restoreTargetId !== null) {
    const targetItem = world.items.find((it) => it.id === extra.steward.restoreTargetId);
    if (targetItem && !targetItem.dropped) {
      drawStewardRestoreArm(ctx, targetItem, extra.steward, tableTopY, t);
    }
  }

  // 5. 手贱橘猫（停靠物体外侧，仅前爪抵住左侧面推进）
  drawCat(ctx, world, extra.steward, tableTopY, extra.animTimeSec);

  // 6. 碎裂粒子与飘字
  drawParticlesAndFloats(ctx, extra.particles, extra.floats);

  // 7. 局内 HUD / 封面 / 结算卡
  if (extra.screenMode === 'playing') {
    drawPlayingHud(ctx, world, extra, t);
  } else if (extra.screenMode === 'title') {
    drawTitleOverlay(
      ctx,
      width,
      height,
      extra.gameMode,
      extra.difficulty,
      extra.stageId,
      extra.progress,
      t,
    );
  } else {
    drawResultOverlay(ctx, width, height, extra, t);
  }

  // 8. ?debug=1 调试视图
  if (extra.debug) {
    drawDebugOverlay(ctx, world, extra.steward, tableEdgeX, height);
  }

  ctx.restore();
}

function drawRoomBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tableTopY: number,
  floorY: number,
  stage: StageConfig,
): void {
  const { palette } = stage;
  const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  wallGrad.addColorStop(0, palette.wallTop);
  wallGrad.addColorStop(1, palette.wallBottom);
  ctx.fillStyle = wallGrad;
  ctx.fillRect(-16, -16, width + 32, floorY + 16);

  // 墙面装饰（按关卡区分）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(28, 128, 76, 56);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillRect(34, 134, 64, 44);
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(66, 156, 11, 0, Math.PI * 2);
  ctx.fill();

  // 踢脚线与地板区
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(0, floorY - 10, width, 10);
  ctx.fillStyle = palette.floor;
  ctx.fillRect(-16, floorY, width + 32, height - floorY + 16);

  // 桌沿右侧深渊轻微警示阴影
  ctx.fillStyle = 'rgba(30, 20, 15, 0.1)';
  ctx.fillRect(
    tuning.scene.tableEdgeX,
    tableTopY,
    width - tuning.scene.tableEdgeX,
    floorY - tableTopY,
  );
}

function drawSteward(
  ctx: CanvasRenderingContext2D,
  steward: StewardState,
  tableTopY: number,
  animTimeSec: number,
): void {
  const cx = 216;
  const shoulderY = tableTopY - 62;
  const headY = shoulderY - 32;
  const isDistracted = steward.phase === 'RELAXED' && steward.distractTimerSec > 0;
  const isCharmed = steward.phase === 'RELAXED' && steward.charmedTimerSec > 0;

  ctx.save();
  const jitter =
    steward.phase === 'WARNING' ? Math.sin(animTimeSec * 28) * 2.2 : 0;
  ctx.translate(cx + jitter, 0);

  if (steward.phase === 'WATCHING' || steward.phase === 'CAUGHT') {
    const grad = ctx.createLinearGradient(0, headY, -60, tableTopY + 10);
    grad.addColorStop(0, 'rgba(229, 62, 62, 0.34)');
    grad.addColorStop(1, 'rgba(229, 62, 62, 0.03)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-8, headY + 4);
    ctx.lineTo(-210, tableTopY + 8);
    ctx.lineTo(90, tableTopY + 8);
    ctx.closePath();
    ctx.fill();
  }

  // 身体（卫衣）
  ctx.fillStyle =
    steward.phase === 'CAUGHT'
      ? '#c94a3d'
      : isCharmed
        ? '#db2777'
        : isDistracted
          ? '#2f855a'
          : '#4a647a';
  ctx.beginPath();
  ctx.roundRect(-34, shoulderY, 68, 72, [22, 22, 0, 0]);
  ctx.fill();

  // 头部
  ctx.fillStyle = '#f4cbb0';
  ctx.beginPath();
  ctx.arc(0, headY, 22, 0, Math.PI * 2);
  ctx.fill();

  if (isCharmed) {
    // 卖萌被迷住：正脸冒粉红爱心眼
    ctx.fillStyle = '#2d2622';
    ctx.beginPath();
    ctx.arc(0, headY - 5, 22.5, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ec4899';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('♥', -7, headY + 3);
    ctx.fillText('♥', 7, headY + 3);
  } else if (steward.phase === 'RELAXED' || steward.phase === 'WARNING') {
    ctx.fillStyle = '#2d2622';
    ctx.beginPath();
    ctx.arc(0, headY - 2, 22.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, headY + 3, 21, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isDistracted
      ? 'rgba(110, 231, 183, 0.65)'
      : 'rgba(130, 215, 255, 0.35)';
    ctx.fillRect(-11, shoulderY + 14, 22, 12);
  } else {
    ctx.fillStyle = '#2d2622';
    ctx.beginPath();
    ctx.arc(0, headY - 5, 22.5, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-7, headY + 1, 5, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(7, headY + 1, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = steward.phase === 'CAUGHT' ? '#d63031' : '#1e1b18';
    ctx.beginPath();
    ctx.arc(-8.5, headY + 2, 2.3, 0, Math.PI * 2);
    ctx.arc(5.5, headY + 2, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#2d2622';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-12, headY - 5);
    ctx.lineTo(-3, headY - 2);
    ctx.moveTo(12, headY - 5);
    ctx.lineTo(3, headY - 2);
    ctx.stroke();

    if (steward.phase === 'CAUGHT') {
      ctx.fillStyle = '#b72b2b';
      ctx.beginPath();
      ctx.ellipse(0, headY + 12, 6, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 头顶状态气泡
  if (isCharmed) {
    if (steward.meowResistant) {
      drawSpeechBubble(
        ctx,
        0,
        headY - 40,
        '别以为每次卖萌都管用…',
        '#fff7ed',
        '#f97316',
        '#c2410c',
        148,
      );
    } else {
      drawSpeechBubble(
        ctx,
        0,
        headY - 40,
        '哎呀好乖~ ♥',
        '#fdf2f8',
        '#ec4899',
        '#be185d',
        104,
      );
    }
  } else if (isDistracted) {
    drawSpeechBubble(
      ctx,
      0,
      headY - 40,
      `📱 回消息中 ${steward.distractTimerSec.toFixed(1)}s`,
      '#ecfdf5',
      '#10b981',
      '#047857',
      118,
    );
  } else if (steward.phase === 'WARNING') {
    drawBadge(ctx, 0, headY - 38, '?', '#ffd166', '#2b2118');
  } else if (steward.phase === 'WATCHING') {
    if (steward.restoreTargetLabel) {
      drawSpeechBubble(
        ctx,
        0,
        headY - 40,
        formatRestoreText(steward.restoreTargetLabel),
        '#fffbeb',
        '#f59e0b',
        '#b45309',
        152,
      );
    } else if (steward.suspiciousTeeter) {
      drawSpeechBubble(
        ctx,
        0,
        headY - 40,
        formatTeeterSuspicionText(steward.suspiciousLabel ?? '东西'),
        '#fffbeb',
        '#f59e0b',
        '#b45309',
        140,
      );
    } else {
      drawBadge(ctx, 0, headY - 38, '盯!', '#ef476f', '#ffffff');
    }
  } else if (steward.phase === 'CAUGHT') {
    drawSpeechBubble(ctx, 0, headY - 40, '你在干嘛！', '#fff5f5', '#d63031', '#c02626', 92);
  }

  ctx.restore();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
): void {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  border: string,
  fg: string,
  w = 96,
): void {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 16, w, 28, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'bold 11.5px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 1);
  ctx.restore();
}

function drawOriginBases(
  ctx: CanvasRenderingContext2D,
  items: readonly TableItem[],
  tableTopY: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 90, 70, 0.32)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 3]);
  for (const item of items) {
    const w = Math.max(18, item.spec.width);
    ctx.beginPath();
    ctx.roundRect(item.originX - w / 2, tableTopY - 4, w, 4, 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStewardRestoreArm(
  ctx: CanvasRenderingContext2D,
  item: TableItem,
  steward: StewardState,
  tableTopY: number,
  t: Tuning,
): void {
  const progress = clamp(
    1 - steward.restoreTimerSec / t.steward.restoreDurationSec,
    0,
    1,
  );
  const reach = progress < 0.45 ? progress / 0.45 : 1;
  const shoulderX = 216;
  const shoulderY = tableTopY - 44;
  const handX = shoulderX + (item.body.position.x - shoulderX) * reach;
  const handY = shoulderY + (item.body.position.y - shoulderY) * reach;

  ctx.save();
  ctx.strokeStyle = '#4a647a';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX - 10, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.fillStyle = '#f4cbb0';
  ctx.strokeStyle = '#9a3412';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(handX, handY, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  _width: number,
  tableTopY: number,
  tableEdgeX: number,
  tableThickness: number,
  floorY: number,
  stage: StageConfig,
): void {
  const { palette } = stage;
  ctx.fillStyle = palette.tableLeg;
  ctx.fillRect(
    tableEdgeX - 30,
    tableTopY + tableThickness,
    18,
    floorY - (tableTopY + tableThickness),
  );

  ctx.fillStyle = palette.tableTop;
  ctx.fillRect(0, tableTopY, tableEdgeX, tableThickness);

  // 材质细节（Stage 3 大理石纹理 / Stage 2 & 4 木纹）
  if (stage.id === 3) {
    ctx.strokeStyle = 'rgba(219, 39, 119, 0.14)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(20, tableTopY + 5);
    ctx.lineTo(110, tableTopY + 14);
    ctx.moveTo(170, tableTopY + 4);
    ctx.lineTo(255, tableTopY + 15);
    ctx.stroke();
  } else if (stage.id === 2 || stage.id === 4) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, tableTopY + 7);
    ctx.lineTo(tableEdgeX - 18, tableTopY + 7);
    ctx.moveTo(40, tableTopY + 14);
    ctx.lineTo(tableEdgeX - 40, tableTopY + 14);
    ctx.stroke();
  }

  ctx.fillStyle = palette.tableEdgeShade;
  ctx.fillRect(0, tableTopY + tableThickness - 6, tableEdgeX, 6);
  ctx.strokeStyle = palette.tableBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, tableTopY);
  ctx.lineTo(tableEdgeX, tableTopY);
  ctx.lineTo(tableEdgeX, tableTopY + tableThickness);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = 'rgba(224, 112, 72, 0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(tableEdgeX, tableTopY - 96);
  ctx.lineTo(tableEdgeX, tableTopY);
  ctx.stroke();
  ctx.restore();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: TableItem,
  _tableEdgeX: number,
  animTimeSec: number,
): void {
  const { body, kind, spec, teeterTier, multiplier } = item;
  const isTeeter = teeterTier !== 'safe';
  const hw = spec.width / 2;
  const hh = spec.height / 2;

  ctx.save();
  const buzzDx = item.isBuzzing ? Math.sin(animTimeSec * 65) * 1.6 : 0;
  ctx.translate(body.position.x + buzzDx, body.position.y);
  ctx.rotate(body.angle);

  switch (kind) {
    case 'tissue': {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d8d2c9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-12, 4);
      ctx.lineTo(-9, -8);
      ctx.lineTo(2, -10);
      ctx.lineTo(13, -4);
      ctx.lineTo(11, 8);
      ctx.lineTo(-4, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawLittleEyes(ctx, 1.5, -1, 3.5);
      break;
    }
    case 'pen':
    case 'lipstick': {
      const r = hw;
      ctx.fillStyle = kind === 'lipstick' ? '#e11d48' : '#e7f5ff';
      ctx.strokeStyle = kind === 'lipstick' ? '#881337' : '#339af0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = kind === 'lipstick' ? '#fda4af' : '#1c7ed6';
      ctx.beginPath();
      ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = kind === 'lipstick' ? '#881337' : '#1c7ed6';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r - 1, 0);
      ctx.stroke();
      break;
    }
    case 'mug': {
      ctx.strokeStyle = '#d97b59';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(hw, 0, 8, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#fff5ea';
      ctx.strokeStyle = '#d97b59';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 4);
      ctx.fill();
      ctx.stroke();
      drawExpressiveFace(ctx, isTeeter, animTimeSec, '#2d241e');
      break;
    }
    case 'kettle': {
      ctx.strokeStyle = '#8b95a1';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(-hw - 7, -hh + 10, 12, 34, 5);
      ctx.stroke();
      ctx.fillStyle = '#e9ecef';
      ctx.beginPath();
      ctx.moveTo(hw - 2, -hh + 10);
      ctx.lineTo(hw + 9, -hh + 14);
      ctx.lineTo(hw - 1, -hh + 24);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f8f9fa';
      ctx.strokeStyle = '#adb5bd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, [10, 10, 4, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#343a40';
      ctx.fillRect(-hw + 1, hh - 9, spec.width - 2, 8);
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(hw - 9, hh - 5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      drawExpressiveFace(ctx, isTeeter, animTimeSec, '#343a40');
      break;
    }
    case 'mouse': {
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, [10, 10, 4, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#334155';
      ctx.fillRect(3, -hh + 2, 5, 4);
      drawLittleEyes(ctx, -4, 0, 3);
      break;
    }
    case 'ink': {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-7, -hh - 3, 14, 6);
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh + 3, spec.width, spec.height - 3, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-hw + 3, -2, spec.width - 6, hh);
      drawLittleEyes(ctx, 0, -6, 4);
      break;
    }
    case 'phone': {
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = item.isBuzzing ? '#22c55e' : '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = item.isBuzzing ? '#4ade80' : '#38bdf8';
      ctx.fillRect(-hw + 4, -hh + 3, spec.width - 8, spec.height - 6);
      break;
    }
    case 'keyboard': {
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      for (let kx = -hw + 5; kx < hw - 7; kx += 8) {
        ctx.fillRect(kx, -hh + 3, 6, 5);
      }
      drawLittleEyes(ctx, 0, 3, 6);
      break;
    }
    case 'compact': {
      ctx.fillStyle = '#fbcfe8';
      ctx.strokeStyle = '#be185d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 7);
      ctx.fill();
      ctx.stroke();
      drawLittleEyes(ctx, 0, 0, 4);
      break;
    }
    case 'perfume': {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(-5, -hh, 10, 8);
      ctx.fillStyle = 'rgba(253, 224, 71, 0.72)';
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh + 8, spec.width, spec.height - 8, 5);
      ctx.fill();
      ctx.stroke();
      drawExpressiveFace(ctx, isTeeter, animTimeSec, '#78350f');
      break;
    }
    case 'mirror': {
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#be185d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height - 8, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.roundRect(-hw + 5, -hh + 5, spec.width - 10, spec.height - 18, 12);
      ctx.fill();
      ctx.fillStyle = '#9d174d';
      ctx.fillRect(-hw + 6, hh - 8, spec.width - 12, 8);
      drawExpressiveFace(ctx, isTeeter, animTimeSec, '#831843');
      break;
    }
    case 'remote': {
      ctx.fillStyle = '#1f2937';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(-hw + 7, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(-4, -3, 18, 6);
      break;
    }
    case 'wineglass': {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, hh - 2);
      ctx.moveTo(-8, hh - 1);
      ctx.lineTo(8, hh - 1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(241, 245, 249, 0.78)';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, 28, [3, 3, 10, 10]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#be123c';
      ctx.beginPath();
      ctx.roundRect(-hw + 2, -hh + 12, spec.width - 4, 14, [0, 0, 8, 8]);
      ctx.fill();
      drawLittleEyes(ctx, 0, -hh + 7, 4);
      break;
    }
    case 'fishbowl': {
      // 圆形玻璃鱼缸 + 蓝色水 + 惊慌小金鱼
      ctx.fillStyle = 'rgba(186, 230, 253, 0.78)';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, spec.width, spec.height, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.beginPath();
      ctx.roundRect(-hw + 3, -6, spec.width - 6, hh + 3, [4, 4, 18, 18]);
      ctx.fill();
      // 惊慌游动的小金鱼
      const swimX = Math.sin(animTimeSec * (isTeeter ? 16 : 5)) * 10;
      const swimY = 6 + Math.cos(animTimeSec * 7) * 3;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.ellipse(swimX, swimY, 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(swimX - 6, swimY);
      ctx.lineTo(swimX - 11, swimY - 4);
      ctx.lineTo(swimX - 11, swimY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(swimX + 3, swimY - 1, 1.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();

  // 手机来电震动提示
  if (item.isBuzzing) {
    ctx.save();
    ctx.fillStyle = '#16a34a';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('嗡嗡!', body.position.x, body.position.y - hh - 10);
    ctx.restore();
  }

  // 悬边流汗与倍率提示
  if (isTeeter) {
    const labelY = body.position.y - hh - 14;
    ctx.save();
    ctx.fillStyle = '#4dabf7';
    const dropOffset = (animTimeSec * 14) % 6;
    ctx.beginPath();
    ctx.arc(body.position.x + hw + 5, body.position.y - 10 + dropOffset, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = multiplier === 3 ? '#e03131' : '#f08c00';
    ctx.beginPath();
    ctx.roundRect(body.position.x - 24, labelY - 10, 48, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(multiplier === 3 ? '×3.0 极限' : '×2.0 悬边', body.position.x, labelY - 1);
    ctx.restore();
  }
}

function drawLittleEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sep: number,
): void {
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(cx - sep, cy, 1.4, 0, Math.PI * 2);
  ctx.arc(cx + sep, cy, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawExpressiveFace(
  ctx: CanvasRenderingContext2D,
  isTeeter: boolean,
  animTimeSec: number,
  color: string,
): void {
  const shake = isTeeter ? Math.sin(animTimeSec * 40) * 1.1 : 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-6 + shake, -2, isTeeter ? 3.2 : 2.1, 0, Math.PI * 2);
  ctx.arc(6 + shake, -2, isTeeter ? 3.2 : 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (isTeeter) {
    ctx.arc(shake, 7, 4, Math.PI, Math.PI * 2);
  } else {
    ctx.moveTo(-4, 5);
    ctx.lineTo(4, 5);
  }
  ctx.stroke();
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  world: CatPushWorld,
  steward: StewardState,
  tableTopY: number,
  animTimeSec: number,
): void {
  const { cat } = world;
  const isNapping = cat.alertness < 0.25 && cat.jumpHeightPx <= 1;
  const squashY = 0.72 + cat.alertness * 0.28;
  const stretchX = 1.14 - cat.alertness * 0.14;

  // 跳跃滞空时在桌面画投影
  if (cat.jumpHeightPx > 1) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    const shadowW = Math.max(10, 22 - cat.jumpHeightPx * 0.18);
    ctx.beginPath();
    ctx.ellipse(cat.x, tableTopY - 1, shadowW, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cat.x, tableTopY - cat.jumpHeightPx);
  ctx.scale(cat.facing * stretchX, squashY);

  const wag = isNapping ? 0 : Math.sin(animTimeSec * (cat.isActive ? 10 : 3)) * 5;
  ctx.strokeStyle = '#e58e3c';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-18, -10);
  ctx.quadraticCurveTo(-34, -18 + wag, -30, -34 + wag);
  ctx.stroke();

  // 身体
  ctx.fillStyle = '#f4a259';
  ctx.beginPath();
  ctx.ellipse(-2, -15, 22, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fde6cd';
  ctx.beginPath();
  ctx.ellipse(4, -11, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 猫头
  const headX = 10;
  const headY = -30 + (1 - cat.alertness) * 9;
  ctx.fillStyle = '#f4a259';
  ctx.beginPath();
  ctx.arc(headX, headY, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e58e3c';
  ctx.beginPath();
  ctx.moveTo(headX - 11, headY - 9);
  ctx.lineTo(headX - 8, headY - 22);
  ctx.lineTo(headX - 1, headY - 13);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(headX + 2, headY - 13);
  ctx.lineTo(headX + 10, headY - 22);
  ctx.lineTo(headX + 12, headY - 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#c86d28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headX - 4, headY - 11);
  ctx.lineTo(headX, headY - 8);
  ctx.lineTo(headX + 4, headY - 11);
  ctx.stroke();

  if (isNapping) {
    ctx.strokeStyle = '#3b2818';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX - 4, headY - 1, 3, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(headX + 6, headY - 1, 3, Math.PI, Math.PI * 2);
    ctx.stroke();

    if (steward.phase === 'WATCHING') {
      ctx.save();
      ctx.scale(cat.facing, 1);
      ctx.fillStyle = '#6c757d';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('zZ', headX * cat.facing + 8, headY - 20);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = '#fff9db';
    ctx.beginPath();
    ctx.arc(headX - 3, headY - 2, 3.8, 0, Math.PI * 2);
    ctx.arc(headX + 7, headY - 2, 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#241b12';
    if (cat.pushingHeavy || cat.pawExtend > 0.5) {
      ctx.beginPath();
      ctx.ellipse(headX - 2.5, headY - 2, 1.3, 3.1, 0, 0, Math.PI * 2);
      ctx.ellipse(headX + 7.5, headY - 2, 1.3, 3.1, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(headX - 2.5, headY - 2, 2.3, 0, Math.PI * 2);
      ctx.arc(headX + 7.5, headY - 2, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#f08c8c';
  ctx.beginPath();
  ctx.arc(headX + 3, headY + 3, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // 伸爪抵住物体左侧面推动（带扒拉微动画）
  if (cat.pawExtend > 0.08 && !isNapping) {
    const pawBob = cat.pushingHeavy ? Math.sin(animTimeSec * 24) * 2.5 : 0;
    const reach = 14 + cat.pawExtend * 13 + pawBob;
    ctx.strokeStyle = '#f4a259';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(12, -16);
    ctx.lineTo(reach, -19 + pawBob * 0.6);
    ctx.stroke();

    ctx.fillStyle = '#fde6cd';
    ctx.beginPath();
    ctx.arc(reach + 2, -19 + pawBob * 0.6, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // 喵呜卖萌气泡
  if (cat.meowBubbleSec > 0) {
    drawSpeechBubble(
      ctx,
      cat.x + cat.facing * 10,
      tableTopY - cat.jumpHeightPx - 58,
      '喵呜~ ♥',
      '#fdf2f8',
      '#ec4899',
      '#be185d',
      76,
    );
  }
}

function drawParticlesAndFloats(
  ctx: CanvasRenderingContext2D,
  particles: readonly Particle[],
  floats: readonly FloatingText[],
): void {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const f of floats) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

function drawPlayingHud(
  ctx: CanvasRenderingContext2D,
  world: CatPushWorld,
  extra: RenderExtra,
  t: Tuning,
): void {
  const { width, height } = t.view;
  const { steward, bill, muted, gameMode, stageId } = extra;
  const stage = STAGES[stageId];

  ctx.save();
  ctx.fillStyle = 'rgba(35, 30, 27, 0.8)';
  ctx.beginPath();
  ctx.roundRect(12, 12, width - 24, 52, 14);
  ctx.fill();

  ctx.fillStyle = steward.remainingSec <= 10 ? '#ff8787' : '#fff7ea';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.ceil(steward.remainingSec)}s`, 24, 44);

  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < steward.hearts ? '#ff6b6b' : '#5c534d';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('♥', 72 + i * 19, 43);
  }

  ctx.fillStyle = '#a89f96';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('噪声', 142, 30);
  ctx.fillStyle = '#4a423d';
  ctx.beginPath();
  ctx.roundRect(142, 36, 72, 8, 4);
  ctx.fill();
  ctx.fillStyle =
    steward.noise > 70 ? '#ff6b6b' : steward.noise > 40 ? '#ffd166' : '#69db7c';
  ctx.beginPath();
  ctx.roundRect(142, 36, (72 * steward.noise) / 100, 8, 4);
  ctx.fill();

  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const scoreLabel =
    gameMode === 'story' ? `¥${bill.totalScore}/${stage.targetScore}` : `¥${bill.totalScore}`;
  ctx.fillText(scoreLabel, width - 54, 44);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(width - 30, 38, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7ea';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(muted ? '🔇' : '🔊', width - 30, 39);

  // 关卡与难度标签条
  const diffLabel = t.difficulties[extra.difficulty].label;
  ctx.fillStyle = 'rgba(35, 30, 27, 0.72)';
  ctx.beginPath();
  ctx.roundRect(16, 68, 154, 20, 10);
  ctx.fill();
  ctx.fillStyle =
    extra.difficulty === 'hard'
      ? '#fca5a5'
      : extra.difficulty === 'easy'
        ? '#86efac'
        : '#fde68a';
  ctx.font = 'bold 11px system-ui, sans-serif';
  const badgeText =
    gameMode === 'story' ? `${stage.shortName} · ${diffLabel}` : `无尽茶水间 · ${diffLabel}`;
  ctx.fillText(badgeText, 93, 78);

  // 右下角 3 个紧凑触屏技能钮：喵~ (E) / 跳 (W) / 轻拍! (Space)
  drawActionCircleButton(
    ctx,
    t.buttons.meow,
    '喵~',
    '(E)',
    clamp(steward.meowCooldownSec / t.cat.meowCooldownSec, 0, 1),
    '#ec4899',
  );
  drawActionCircleButton(ctx, t.buttons.jump, '跳', '(W)', 0, '#0ea5e9');
  drawActionCircleButton(
    ctx,
    t.buttons.tap,
    '轻拍!',
    '(Space)',
    clamp(world.cat.tapCooldownSec / t.cat.tapCooldownSec, 0, 1),
    '#e07040',
  );

  // 底部极简操控提示
  ctx.fillStyle = 'rgba(255, 247, 234, 0.78)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('按住左/右推 · 松手装睡', 16, height - 16);

  ctx.restore();
}

function drawActionCircleButton(
  ctx: CanvasRenderingContext2D,
  btn: { readonly x: number; readonly y: number; readonly r: number },
  title: string,
  hotkey: string,
  cdRatio: number,
  activeColor: string,
): void {
  const ready = cdRatio <= 0.01;
  ctx.fillStyle = ready ? activeColor : 'rgba(71, 85, 105, 0.88)';
  ctx.beginPath();
  ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ready ? '#fde68a' : '#94a3b8';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  if (!ready) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(
      btn.x,
      btn.y,
      btn.r - 3,
      -Math.PI / 2,
      -Math.PI / 2 + (1 - cdRatio) * Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${btn.r >= 28 ? 13 : 12}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, btn.x, btn.y - 5);
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.fillText(hotkey, btn.x, btn.y + 9);
}

function drawTitleOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gameMode: GameMode,
  difficulty: DifficultyMode,
  stageId: StageId,
  progress: StageProgress,
  t: Tuning,
): void {
  const diffProgress = progress.byDifficulty[difficulty];
  const diffCfg = t.difficulties[difficulty];

  ctx.save();
  ctx.fillStyle = 'rgba(28, 22, 18, 0.64)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff8ef';
  ctx.beginPath();
  ctx.roundRect(22, 72, width - 44, 452, 24);
  ctx.fill();

  ctx.fillStyle = '#e07040';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CAT PUSH · 鬼点子生成中', width / 2, 98);

  ctx.fillStyle = '#2b241f';
  ctx.font = 'bold 23px system-ui, sans-serif';
  ctx.fillText('把东西推下桌！', width / 2, 126);

  // 双模式切换开关 (y: 144..174)
  const modes: Array<{ id: GameMode; label: string; x: number }> = [
    { id: 'story', label: '闯关捣蛋 (4关)', x: 40 },
    { id: 'endless', label: '无尽茶水间', x: 200 },
  ];
  for (const m of modes) {
    const active = gameMode === m.id;
    ctx.fillStyle = active ? '#e07040' : '#efe5d8';
    ctx.beginPath();
    ctx.roundRect(m.x, 144, 150, 30, 12);
    ctx.fill();
    ctx.fillStyle = active ? '#ffffff' : '#5e534a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(m.label, m.x + 75, 163);
  }

  // 3 档难度分段切换开关 (y: 184..212)
  const diffs: Array<{ id: DifficultyMode; x: number; activeColor: string }> = [
    { id: 'easy', x: 40, activeColor: '#059669' },
    { id: 'normal', x: 145, activeColor: '#d97706' },
    { id: 'hard', x: 250, activeColor: '#dc2626' },
  ];
  for (const d of diffs) {
    const active = difficulty === d.id;
    ctx.fillStyle = active ? d.activeColor : '#efe5d8';
    ctx.beginPath();
    ctx.roundRect(d.x, 184, 100, 28, 10);
    ctx.fill();
    ctx.fillStyle = active ? '#ffffff' : '#5e534a';
    ctx.font = 'bold 12.5px system-ui, sans-serif';
    ctx.fillText(t.difficulties[d.id].label, d.x + 50, 202);
  }

  ctx.fillStyle = '#7a6f64';
  ctx.font = '600 11.5px system-ui, sans-serif';
  ctx.fillText(diffCfg.subtitle, width / 2, 229);

  if (gameMode === 'story') {
    // 4 个主题房间选关卡片 (y: 242..302)
    STAGE_IDS.forEach((id, idx) => {
      const st = STAGES[id];
      const unlocked = id <= diffProgress.unlockedStage;
      const selected = stageId === id;
      const sx = 34 + idx * 82;
      ctx.fillStyle = selected ? '#2b241f' : unlocked ? '#f3e8da' : '#e5ded5';
      ctx.beginPath();
      ctx.roundRect(sx, 242, 76, 60, 12);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = '#e07040';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.fillStyle = selected ? '#ffffff' : unlocked ? '#2b241f' : '#9c9288';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(unlocked ? st.shortName : `🔒${id}关`, sx + 38, 261);

      const stars = diffProgress.stars[id];
      ctx.fillStyle = stars > 0 ? '#f59e0b' : '#b8ada2';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('★'.repeat(stars) + '☆'.repeat(3 - stars), sx + 38, 279);

      ctx.fillStyle = selected ? '#fde68a' : '#7a6f64';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`¥${st.targetScore}`, sx + 38, 294);
    });

    const cur = STAGES[stageId];
    ctx.fillStyle = '#5e534a';
    ctx.font = 'bold 13.5px system-ui, sans-serif';
    ctx.fillText(`${cur.name} · 目标 ¥${cur.targetScore}`, width / 2, 329);
    ctx.font = '12.5px system-ui, sans-serif';
    ctx.fillText(cur.subtitle, width / 2, 351);
    ctx.fillText('趁主人分心/背对推向桌沿，冒「?」立刻松手装睡！', width / 2, 379);
    ctx.fillText('悬边摇晃(×2/×3)再推落翻倍，高重心香水别桌上摔碎', width / 2, 403);
  } else {
    ctx.fillStyle = '#5e534a';
    ctx.font = '13.5px system-ui, sans-serif';
    const lines = [
      '60 秒茶水间无限补货冲榜！',
      '第 2 桌起物品站位与间距随机打乱',
      '趁主人📱回消息分心猛推重物电水壶！',
      `当前难度最高账单：¥${diffProgress.endlessBestScore}`,
    ];
    lines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, 268 + idx * 32);
    });
  }

  // 开始按钮 (y: 444..496)
  ctx.fillStyle = '#e07040';
  ctx.beginPath();
  ctx.roundRect(64, 444, width - 128, 52, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('开始捣蛋', width / 2, 475);

  ctx.restore();
}

function drawResultOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  extra: RenderExtra,
  t: Tuning,
): void {
  const { steward, bill, gameMode, difficulty, stageId, progress } = extra;
  const stage = STAGES[stageId];
  const diffProgress = progress.byDifficulty[difficulty];
  const diffLabel = t.difficulties[difficulty].label;

  ctx.save();
  ctx.fillStyle = 'rgba(24, 18, 15, 0.72)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff9f2';
  ctx.beginPath();
  ctx.roundRect(24, 96, width - 48, 444, 24);
  ctx.fill();

  const caughtOut = steward.endReason === 'hearts_zero';
  const passedStory =
    gameMode === 'story' && !caughtOut && bill.totalScore >= stage.targetScore;
  ctx.fillStyle = caughtOut ? '#d63031' : passedStory ? '#059669' : '#e07040';
  ctx.font = 'bold 21px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const title = caughtOut
    ? '被当场抓包！'
    : gameMode === 'story'
      ? passedStory
        ? `${stage.shortName} 通关成功！`
        : '目标金额未达成'
      : '60 秒捣蛋结算';
  ctx.fillText(`${title} [${diffLabel}]`, width / 2, 138);

  ctx.fillStyle = '#2b241f';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(`赔偿 ¥${bill.totalScore}`, width / 2, 186);

  if (gameMode === 'story') {
    const stars = diffProgress.stars[stageId];
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('★'.repeat(stars) + '☆'.repeat(3 - stars), width / 2, 220);
  }

  ctx.fillStyle = '#6c5f55';
  ctx.font = '13.5px system-ui, sans-serif';
  const totalDropped = bill.records.length;
  const rows = [
    `共推落物品：${totalDropped} 件`,
    `悬边挑衅成功：${bill.teeterDrops} 次（极限 ×3 共 ${bill.extremeTeeterDrops} 次）`,
    bill.damagedDrops > 0
      ? `桌上提前摔碎折损：${bill.damagedDrops} 件（仅得半价）`
      : `剩余忍耐红心：${steward.hearts} / 3`,
    gameMode === 'story'
      ? `本关目标：¥${stage.targetScore} · 最高 ¥${diffProgress.bestScores[stageId]}`
      : `无尽最高赔偿：¥${diffProgress.endlessBestScore}`,
  ];
  rows.forEach((row, i) => {
    ctx.fillText(row, width / 2, 260 + i * 30);
  });

  if (gameMode === 'story' && passedStory && stageId < 4) {
    // 下一关按钮 (y: 404..452)
    ctx.fillStyle = '#059669';
    ctx.beginPath();
    ctx.roundRect(64, 404, width - 128, 48, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText(`进入 ${STAGES[(stageId + 1) as StageId].shortName}`, width / 2, 433);
  }

  // 再来一桌 / 返回按钮 (y: 462..512)
  ctx.fillStyle = '#2b241f';
  ctx.beginPath();
  ctx.roundRect(64, 462, width - 128, 50, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.fillText('再来一桌 (R)', width / 2, 492);

  ctx.restore();
}

function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  world: CatPushWorld,
  steward: StewardState,
  tableEdgeX: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 1;

  for (const item of world.items) {
    if (item.dropped) continue;
    const verts = item.body.vertices;
    ctx.beginPath();
    verts.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    ctx.stroke();

    const dx = (item.body.position.x - tableEdgeX).toFixed(0);
    const deg = ((item.body.angle * 180) / Math.PI).toFixed(1);
    ctx.fillStyle = '#00e5ff';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText(
      `dx=${dx} θ=${deg}° x${item.multiplier}`,
      item.body.position.x - 24,
      item.body.position.y - item.spec.height / 2 - 22,
    );
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(8, height - 62, 272, 38);
  ctx.fillStyle = '#00e5ff';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    `steward=${steward.phase} t=${steward.phaseTimerSec.toFixed(2)}s dist=${steward.distractTimerSec.toFixed(1)}s`,
    14,
    height - 46,
  );
  ctx.fillText(
    `catX=${world.cat.x.toFixed(1)} alert=${world.cat.alertness.toFixed(2)} wave=${world.waveCount}`,
    14,
    height - 30,
  );
  ctx.restore();
}
