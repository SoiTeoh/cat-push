import { tuning, type Tuning } from '../config/tuning';
import type { BillSummary, StewardState } from '../game/rules';
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
  readonly steward: StewardState;
  readonly bill: BillSummary;
  readonly bestScore: number;
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

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(extra.shakeX, extra.shakeY);

  // 1. 温暖室内背景墙与地板
  drawRoomBackground(ctx, width, height, tableTopY, floorY);

  // 2. 背景监控区：低头刷手机的铲屎官
  drawSteward(ctx, extra.steward, tableTopY, extra.animTimeSec);

  // 3. 白色平滑桌面 + 清晰右桌沿
  drawTable(ctx, width, tableTopY, tableEdgeX, tableThickness, floorY);

  // 4. 桌面物品（带悬边惊恐流汗与倍率提示）
  for (const item of world.items) {
    if (item.dropped) continue;
    drawItem(ctx, item, tableEdgeX, extra.animTimeSec);
  }

  // 5. 手贱橘猫（含 3 种瞳孔表情与 0.12s 眯眼装睡）
  drawCat(ctx, world, extra.steward, tableTopY, extra.animTimeSec);

  // 6. 碎裂粒子与飘字
  drawParticlesAndFloats(ctx, extra.particles, extra.floats);

  // 7. 局内极简 HUD（或封面 / 结算卡）
  if (extra.screenMode === 'playing') {
    drawPlayingHud(ctx, extra.steward, extra.bill, extra.muted, width, height);
  } else if (extra.screenMode === 'title') {
    drawTitleOverlay(ctx, width, height, extra.bestScore);
  } else {
    drawResultOverlay(ctx, width, height, extra.steward, extra.bill, extra.bestScore);
  }

  // 8. ?debug=1 调试视图（刚体轮廓、质心偏移、倾角、状态机倒计时）
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
): void {
  const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  wallGrad.addColorStop(0, '#f7efe3');
  wallGrad.addColorStop(1, '#eadbc8');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(-16, -16, width + 32, floorY + 16);

  // 墙面暖色挂画装饰
  ctx.fillStyle = '#dfcbb2';
  ctx.fillRect(28, 128, 76, 56);
  ctx.fillStyle = '#fbf5ec';
  ctx.fillRect(34, 134, 64, 44);
  ctx.fillStyle = '#e89d58';
  ctx.beginPath();
  ctx.arc(66, 156, 12, 0, Math.PI * 2);
  ctx.fill();

  // 踢脚线与地板区
  ctx.fillStyle = '#d3bea4';
  ctx.fillRect(0, floorY - 10, width, 10);
  ctx.fillStyle = '#8b6a4e';
  ctx.fillRect(-16, floorY, width + 32, height - floorY + 16);

  // 桌沿右侧深渊轻微警示阴影
  ctx.fillStyle = 'rgba(72, 46, 26, 0.08)';
  ctx.fillRect(tuning.scene.tableEdgeX, tableTopY, width - tuning.scene.tableEdgeX, floorY - tableTopY);
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

  ctx.save();
  // WARNING 时肩膀微抖
  const jitter =
    steward.phase === 'WARNING' ? Math.sin(animTimeSec * 28) * 2.2 : 0;
  ctx.translate(cx + jitter, 0);

  // WATCHING 红色视线扫射光束
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
  ctx.fillStyle = steward.phase === 'CAUGHT' ? '#c94a3d' : '#4a647a';
  ctx.beginPath();
  ctx.roundRect(-34, shoulderY, 68, 72, [22, 22, 0, 0]);
  ctx.fill();

  // 头部
  ctx.fillStyle = '#f4cbb0';
  ctx.beginPath();
  ctx.arc(0, headY, 22, 0, Math.PI * 2);
  ctx.fill();

  if (steward.phase === 'RELAXED' || steward.phase === 'WARNING') {
    // 背对低头刷手机：后脑勺黑发 + 微弱手机光
    ctx.fillStyle = '#2d2622';
    ctx.beginPath();
    ctx.arc(0, headY - 2, 22.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, headY + 3, 21, 0, Math.PI * 2);
    ctx.fill();

    // 手机屏幕蓝光
    ctx.fillStyle = 'rgba(130, 215, 255, 0.35)';
    ctx.fillRect(-11, shoulderY + 14, 22, 12);
  } else {
    // WATCHING / CAUGHT：转头正脸紧盯桌面
    ctx.fillStyle = '#2d2622';
    ctx.beginPath();
    ctx.arc(0, headY - 5, 22.5, Math.PI, Math.PI * 2);
    ctx.fill();

    // 眼睛盯着左下方的猫
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

    // 皱眉 / 怒嘴
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

  // 头顶状态提示气泡
  if (steward.phase === 'WARNING') {
    drawBadge(ctx, 0, headY - 38, '?', '#ffd166', '#2b2118');
  } else if (steward.phase === 'WATCHING') {
    drawBadge(ctx, 0, headY - 38, '盯!', '#ef476f', '#ffffff');
  } else if (steward.phase === 'CAUGHT') {
    drawSpeechBubble(ctx, 0, headY - 40, '你在干嘛！');
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
): void {
  ctx.save();
  ctx.fillStyle = '#fff5f5';
  ctx.strokeStyle = '#d63031';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - 46, y - 16, 92, 28, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c02626';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 1);
  ctx.restore();
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  _width: number,
  tableTopY: number,
  tableEdgeX: number,
  tableThickness: number,
  floorY: number,
): void {
  // 桌腿
  ctx.fillStyle = '#c59b76';
  ctx.fillRect(tableEdgeX - 30, tableTopY + tableThickness, 18, floorY - (tableTopY + tableThickness));

  // 白色平滑桌面
  ctx.fillStyle = '#fcfaf6';
  ctx.fillRect(0, tableTopY, tableEdgeX, tableThickness);

  // 桌面高光边线与木质下沿
  ctx.fillStyle = '#e7dfd5';
  ctx.fillRect(0, tableTopY + tableThickness - 6, tableEdgeX, 6);
  ctx.strokeStyle = '#cbbba8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, tableTopY);
  ctx.lineTo(tableEdgeX, tableTopY);
  ctx.lineTo(tableEdgeX, tableTopY + tableThickness);
  ctx.stroke();

  // 悬边危险区提示虚线（桌沿边界）
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

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  if (kind === 'tissue') {
    // 揉皱纸巾团
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

    // 淡定小豆眼
    ctx.fillStyle = '#4a4540';
    ctx.beginPath();
    ctx.arc(-2, -1, 1.4, 0, Math.PI * 2);
    ctx.arc(5, -1, 1.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'pen') {
    // 容易滚动的圆珠笔截面/滚轴
    const r = spec.width / 2;
    ctx.fillStyle = '#e7f5ff';
    ctx.strokeStyle = '#339af0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 笔芯标记线，滚动时能明显看出在转
    ctx.fillStyle = '#1c7ed6';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c7ed6';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r - 1, 0);
    ctx.stroke();
  } else if (kind === 'mug') {
    // 花纹陶瓷马克杯 + 惊恐流汗小脸
    const hw = spec.width / 2;
    const hh = spec.height / 2;

    // 右侧杯耳
    ctx.strokeStyle = '#d97b59';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hw, 0, 8, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();

    // 杯身
    ctx.fillStyle = '#fff5ea';
    ctx.strokeStyle = '#d97b59';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, spec.width, spec.height, 4);
    ctx.fill();
    ctx.stroke();

    // 波点装饰
    ctx.fillStyle = '#f2a679';
    ctx.beginPath();
    ctx.arc(-9, -11, 2.5, 0, Math.PI * 2);
    ctx.arc(9, 11, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 拟人表情（悬边时惊恐震颤）
    const shake = isTeeter ? Math.sin(animTimeSec * 40) * 1.2 : 0;
    ctx.fillStyle = '#2d241e';
    if (isTeeter) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-6 + shake, -2, 4, 0, Math.PI * 2);
      ctx.arc(6 + shake, -2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2d241e';
      ctx.beginPath();
      ctx.arc(-6 + shake, -2, 1.5, 0, Math.PI * 2);
      ctx.arc(6 + shake, -2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // 张嘴惊恐 O
      ctx.beginPath();
      ctx.ellipse(shake, 7, 3.2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(-6, -2, 2.1, 0, Math.PI * 2);
      ctx.arc(6, -2, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2d241e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, 5);
      ctx.lineTo(4, 5);
      ctx.stroke();
    }
  } else if (kind === 'kettle') {
    // 白色电水壶 Boss
    const hw = spec.width / 2;
    const hh = spec.height / 2;

    // 把手
    ctx.strokeStyle = '#8b95a1';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(-hw - 7, -hh + 10, 12, 34, 5);
    ctx.stroke();

    // 壶嘴
    ctx.fillStyle = '#e9ecef';
    ctx.beginPath();
    ctx.moveTo(hw - 2, -hh + 10);
    ctx.lineTo(hw + 9, -hh + 14);
    ctx.lineTo(hw - 1, -hh + 24);
    ctx.closePath();
    ctx.fill();

    // 壶身
    ctx.fillStyle = '#f8f9fa';
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, spec.width, spec.height, [10, 10, 4, 4]);
    ctx.fill();
    ctx.stroke();

    // 黑色底座条与红灯
    ctx.fillStyle = '#343a40';
    ctx.fillRect(-hw + 1, hh - 9, spec.width - 2, 8);
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(hw - 9, hh - 5, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 厚重淡定表情（悬边时也慌了）
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.arc(-8, -4, isTeeter ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.arc(8, -4, isTeeter ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#343a40';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (isTeeter) {
      ctx.arc(0, 8, 5, Math.PI, Math.PI * 2);
    } else {
      ctx.moveTo(-6, 6);
      ctx.lineTo(6, 6);
    }
    ctx.stroke();
  }

  ctx.restore();

  // 悬边流汗与倍率提示（不随刚体旋转，保持水平清晰可读）
  if (isTeeter) {
    const labelY = body.position.y - spec.height / 2 - 14;
    ctx.save();
    // 汗滴
    ctx.fillStyle = '#4dabf7';
    const dropOffset = (animTimeSec * 14) % 6;
    ctx.beginPath();
    ctx.arc(body.position.x + spec.width / 2 + 5, body.position.y - 10 + dropOffset, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 倍率胶囊
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

function drawCat(
  ctx: CanvasRenderingContext2D,
  world: CatPushWorld,
  steward: StewardState,
  tableTopY: number,
  animTimeSec: number,
): void {
  const { cat } = world;
  const isNapping = cat.alertness < 0.25;
  const squashY = 0.72 + cat.alertness * 0.28; // 装睡时压扁贴桌
  const stretchX = 1.14 - cat.alertness * 0.14;

  ctx.save();
  ctx.translate(cat.x, tableTopY);
  ctx.scale(cat.facing * stretchX, squashY);

  // 尾巴（装睡时卷紧，清醒时微翘摆动）
  const wag = isNapping ? 0 : Math.sin(animTimeSec * (cat.isActive ? 10 : 3)) * 5;
  ctx.strokeStyle = '#e58e3c';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-18, -10);
  ctx.quadraticCurveTo(-34, -18 + wag, -30, -34 + wag);
  ctx.stroke();

  // 身体（圆润橘猫）
  ctx.fillStyle = '#f4a259';
  ctx.beginPath();
  ctx.ellipse(-2, -15, 22, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // 肚皮浅色斑
  ctx.fillStyle = '#fde6cd';
  ctx.beginPath();
  ctx.ellipse(4, -11, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 猫头
  const headX = 12;
  const headY = -30 + (1 - cat.alertness) * 9;
  ctx.fillStyle = '#f4a259';
  ctx.beginPath();
  ctx.arc(headX, headY, 15, 0, Math.PI * 2);
  ctx.fill();

  // 猫耳
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

  // 额头虎斑 M 纹
  ctx.strokeStyle = '#c86d28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headX - 4, headY - 11);
  ctx.lineTo(headX, headY - 8);
  ctx.lineTo(headX + 4, headY - 11);
  ctx.stroke();

  // 3 种瞳孔表情：装睡 ^ ◡ ^ / 推物竖瞳聚焦 / 正常大圆瞳
  if (isNapping) {
    ctx.strokeStyle = '#3b2818';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX - 4, headY - 1, 3, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(headX + 6, headY - 1, 3, Math.PI, Math.PI * 2);
    ctx.stroke();

    // 装睡 Zzz 气泡（在铲屎官盯防时特别搞笑）
    if (steward.phase === 'WATCHING') {
      ctx.save();
      ctx.scale(cat.facing, 1); // 文字不翻转
      ctx.fillStyle = '#6c757d';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('zZ', headX * cat.facing + 8, headY - 20);
      ctx.restore();
    }
  } else {
    // 眼白/底色
    ctx.fillStyle = '#fff9db';
    ctx.beginPath();
    ctx.arc(headX - 3, headY - 2, 3.8, 0, Math.PI * 2);
    ctx.arc(headX + 7, headY - 2, 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#241b12';
    if (cat.pushingHeavy || cat.pawExtend > 0.5) {
      // 专注竖瞳（鬼点子生成中！）
      ctx.beginPath();
      ctx.ellipse(headX - 2.5, headY - 2, 1.3, 3.1, 0, 0, Math.PI * 2);
      ctx.ellipse(headX + 7.5, headY - 2, 1.3, 3.1, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 正常圆瞳
      ctx.beginPath();
      ctx.arc(headX - 2.5, headY - 2, 2.3, 0, Math.PI * 2);
      ctx.arc(headX + 7.5, headY - 2, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 粉鼻子与小嘴
  ctx.fillStyle = '#f08c8c';
  ctx.beginPath();
  ctx.arc(headX + 3, headY + 3, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // 伸爪推物（手贱猫爪）
  if (cat.pawExtend > 0.08 && !isNapping) {
    const reach = 12 + cat.pawExtend * 14;
    ctx.strokeStyle = '#f4a259';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(10, -16);
    ctx.lineTo(reach, -18);
    ctx.stroke();

    ctx.fillStyle = '#fde6cd';
    ctx.beginPath();
    ctx.arc(reach + 2, -18, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
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
  steward: StewardState,
  bill: BillSummary,
  muted: boolean,
  width: number,
  height: number,
): void {
  ctx.save();
  // 顶部半透明信息条
  ctx.fillStyle = 'rgba(35, 30, 27, 0.78)';
  ctx.beginPath();
  ctx.roundRect(12, 12, width - 24, 52, 14);
  ctx.fill();

  // 倒计时
  ctx.fillStyle = steward.remainingSec <= 10 ? '#ff8787' : '#fff7ea';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.ceil(steward.remainingSec)}s`, 26, 44);

  // 3 颗红心
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < steward.hearts ? '#ff6b6b' : '#5c534d';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('♥', 76 + i * 20, 43);
  }

  // 噪声条
  ctx.fillStyle = '#a89f96';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('噪声', 148, 30);
  ctx.fillStyle = '#4a423d';
  ctx.beginPath();
  ctx.roundRect(148, 36, 76, 8, 4);
  ctx.fill();
  ctx.fillStyle =
    steward.noise > 70 ? '#ff6b6b' : steward.noise > 40 ? '#ffd166' : '#69db7c';
  ctx.beginPath();
  ctx.roundRect(148, 36, (76 * steward.noise) / 100, 8, 4);
  ctx.fill();

  // 破坏金额
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`¥${bill.totalScore}`, width - 56, 44);

  // 静音按钮
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(width - 32, 38, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7ea';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(muted ? '🔇' : '🔊', width - 32, 39);

  // 底部极简操控提示
  ctx.fillStyle = 'rgba(255, 247, 234, 0.72)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('按住左/右推物 · 松手立刻装睡 · Space 轻拍', width / 2, height - 16);

  ctx.restore();
}

function drawTitleOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bestScore: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(28, 22, 18, 0.62)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff8ef';
  ctx.beginPath();
  ctx.roundRect(28, 120, width - 56, 360, 24);
  ctx.fill();

  ctx.fillStyle = '#e07040';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CAT PUSH · 鬼点子生成中', width / 2, 160);

  ctx.fillStyle = '#2b241f';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('把东西推下桌！', width / 2, 198);

  ctx.fillStyle = '#5e534a';
  ctx.font = '14px system-ui, sans-serif';
  const lines = [
    '1. 按住屏幕右半边/按 D → 悄悄推向桌沿',
    '2. 推到悬空一半 (×2 / ×3) 再推落赚翻倍',
    '3. 铲屎官头顶冒「?」立刻松手装睡！',
    '4. 滚落中的圆珠笔也会当场出卖你',
  ];
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, 246 + idx * 30);
  });

  if (bestScore > 0) {
    ctx.fillStyle = '#c96f2d';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`历史最高破坏账单：¥${bestScore}`, width / 2, 382);
  }

  // 开始按钮
  ctx.fillStyle = '#e07040';
  ctx.beginPath();
  ctx.roundRect(64, 408, width - 128, 50, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('开始捣蛋', width / 2, 439);

  ctx.restore();
}

function drawResultOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  steward: StewardState,
  bill: BillSummary,
  bestScore: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(24, 18, 15, 0.72)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff9f2';
  ctx.beginPath();
  ctx.roundRect(26, 108, width - 52, 412, 24);
  ctx.fill();

  const caughtOut = steward.endReason === 'hearts_zero';
  ctx.fillStyle = caughtOut ? '#d63031' : '#e07040';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(caughtOut ? '被当场抓包！' : '60 秒捣蛋结算', width / 2, 154);

  ctx.fillStyle = '#2b241f';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(`赔偿 ¥${bill.totalScore}`, width / 2, 204);

  ctx.fillStyle = '#6c5f55';
  ctx.font = '14px system-ui, sans-serif';
  const rows = [
    `推落纸巾团：${bill.counts.tissue} 个`,
    `滚落圆珠笔：${bill.counts.pen} 支`,
    `打碎马克杯：${bill.counts.mug} 个`,
    `推翻电水壶：${bill.counts.kettle} 个`,
    `悬边挑衅成功：${bill.teeterDrops} 次（极限 ${bill.extremeTeeterDrops} 次）`,
  ];
  rows.forEach((row, i) => {
    ctx.fillText(row, width / 2, 250 + i * 28);
  });

  ctx.fillStyle = '#c96f2d';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText(`本机最高赔偿：¥${Math.max(bestScore, bill.totalScore)}`, width / 2, 408);

  // 再来一桌按钮
  ctx.fillStyle = '#2b241f';
  ctx.beginPath();
  ctx.roundRect(64, 434, width - 128, 52, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('再来一桌 (R)', width / 2, 466);

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
  ctx.fillRect(8, height - 62, 260, 38);
  ctx.fillStyle = '#00e5ff';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    `steward=${steward.phase} t=${steward.phaseTimerSec.toFixed(2)}s noise=${steward.noise.toFixed(1)}`,
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
