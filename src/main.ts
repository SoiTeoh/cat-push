import './style.css';
import { STAGES, STAGE_IDS, type GameMode, type StageId } from './config/stages';
import { tuning, type ItemKind } from './config/tuning';
import { SoundEngine } from './game/audio';
import {
  applyStageResult,
  createBillSummary,
  createInitialProgress,
  createStewardState,
  evaluateStageStars,
  recordItemDrop,
  stepSteward,
  type BillSummary,
  type StageProgress,
  type StewardState,
} from './game/rules';
import { CatPushWorld } from './game/world';
import { drawGameFrame, type FloatingText, type Particle } from './render/painter';

const PROGRESS_KEY = 'cat_push_progress_v2';

function readProgress(): StageProgress {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createInitialProgress();
    const parsed = JSON.parse(raw) as Partial<StageProgress>;
    const base = createInitialProgress();
    return {
      unlockedStage:
        parsed.unlockedStage && parsed.unlockedStage >= 1 && parsed.unlockedStage <= 4
          ? parsed.unlockedStage
          : base.unlockedStage,
      stars: { ...base.stars, ...(parsed.stars ?? {}) },
      bestScores: { ...base.bestScores, ...(parsed.bestScores ?? {}) },
      endlessBestScore:
        typeof parsed.endlessBestScore === 'number' && parsed.endlessBestScore > 0
          ? parsed.endlessBestScore
          : 0,
    };
  } catch {
    return createInitialProgress();
  }
}

function writeProgress(progress: StageProgress): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage failures in restricted contexts
  }
}

function itemColor(kind: ItemKind): string {
  switch (kind) {
    case 'tissue':
      return '#f8fafc';
    case 'pen':
      return '#339af0';
    case 'mug':
      return '#f2a679';
    case 'kettle':
      return '#cbd5e1';
    case 'mouse':
      return '#e2e8f0';
    case 'ink':
      return '#0f172a';
    case 'phone':
      return '#22c55e';
    case 'keyboard':
      return '#475569';
    case 'lipstick':
      return '#e11d48';
    case 'compact':
      return '#f472b6';
    case 'perfume':
      return '#fde047';
    case 'mirror':
      return '#bae6fd';
    case 'remote':
      return '#374151';
    case 'wineglass':
      return '#be123c';
    case 'fishbowl':
      return '#38bdf8';
  }
}

function main(): void {
  const canvasEl = document.getElementById('stage');
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #stage not found');
  }
  const maybeCtx = canvasEl.getContext('2d');
  if (!maybeCtx) {
    throw new Error('2D rendering context unavailable');
  }
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get('debug') === '1';

  const sound = new SoundEngine();
  let progress = readProgress();
  let gameMode: GameMode = 'story';
  let stageId: StageId = 1;
  let world = new CatPushWorld(tuning, STAGES[stageId].items);
  let steward: StewardState = createStewardState(tuning);
  let bill: BillSummary = createBillSummary();
  let screenMode: 'title' | 'playing' | 'result' = 'title';
  let waveNumber = 1;

  const particles: Particle[] = [];
  const floats: FloatingText[] = [];
  let shakeMag = 0;
  let animTimeSec = 0;

  let movePointerActive = false;
  let movePointerId: number | null = null;
  let movePointerSide: -1 | 0 | 1 = 0;
  const heldKeys = new Set<string>();
  let tapQueued = false;

  let dpr = 1;

  function resizeCanvas(): void {
    const vw = Math.max(240, window.innerWidth);
    const vh = Math.max(320, window.innerHeight);
    const aspect = tuning.view.width / tuning.view.height;

    let cssWidth = vw;
    let cssHeight = cssWidth / aspect;
    if (cssHeight > vh) {
      cssHeight = vh;
      cssWidth = cssHeight * aspect;
    }

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${Math.floor(cssWidth)}px`;
    canvas.style.height = `${Math.floor(cssHeight)}px`;
    canvas.width = Math.round(tuning.view.width * dpr);
    canvas.height = Math.round(tuning.view.height * dpr);
  }

  function toLogicalCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const rx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const ry = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    return {
      x: Math.max(0, Math.min(tuning.view.width, rx * tuning.view.width)),
      y: Math.max(0, Math.min(tuning.view.height, ry * tuning.view.height)),
    };
  }

  function clearInputs(): void {
    movePointerActive = false;
    movePointerId = null;
    movePointerSide = 0;
    heldKeys.clear();
    tapQueued = false;
  }

  function activeStageItems(): readonly ItemKind[] {
    return gameMode === 'story' ? STAGES[stageId].items : STAGES[1].items;
  }

  function startNewGame(nextStageId: StageId = stageId): void {
    sound.unlock();
    stageId = nextStageId;
    const items = activeStageItems();
    world = new CatPushWorld(tuning, items);
    waveNumber = 1;
    world.spawnWave(waveNumber, items);
    steward = createStewardState(tuning);
    bill = createBillSummary();
    particles.length = 0;
    floats.length = 0;
    shakeMag = 0;
    clearInputs();
    screenMode = 'playing';
  }

  function finishMatch(endReason: StewardState['endReason']): void {
    steward = { ...steward, finished: true, endReason };
    screenMode = 'result';
    clearInputs();
    if (gameMode === 'story') {
      const target = STAGES[stageId].targetScore;
      const stars =
        endReason === 'hearts_zero' ? 0 : evaluateStageStars(bill.totalScore, target, steward.hearts);
      progress = applyStageResult(progress, stageId, bill.totalScore, stars);
    } else if (bill.totalScore > progress.endlessBestScore) {
      progress = { ...progress, endlessBestScore: Math.floor(bill.totalScore) };
    }
    writeProgress(progress);
  }

  function spawnDropEffects(
    x: number,
    y: number,
    kind: ItemKind,
    score: number,
    multiplier: 1 | 2 | 3,
    brokeOnTable: boolean,
  ): void {
    const count =
      kind === 'fishbowl'
        ? 26
        : kind === 'ink' || kind === 'compact'
          ? 20
          : tuning.items[kind].heavy
            ? 18
            : 10;
    const baseColor = itemColor(kind);

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = 70 + Math.random() * 200;
      const isGoldfish = kind === 'fishbowl' && i < 3;
      particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (isGoldfish ? 110 : 40),
        r: isGoldfish ? 5 : 2.5 + Math.random() * 3.5,
        color: isGoldfish ? '#f97316' : i % 3 === 0 ? '#fde68a' : baseColor,
        life: 0.6 + Math.random() * 0.3,
        maxLife: 0.9,
      });
    }

    const prefix = brokeOnTable ? '提前摔碎 +¥' : '+¥';
    const multLabel = !brokeOnTable && multiplier > 1 ? ` ×${multiplier}!` : '';
    floats.push({
      x: Math.max(54, Math.min(tuning.view.width - 54, x)),
      y: y - 16,
      text: `${prefix}${score}${multLabel}`,
      color: brokeOnTable
        ? '#f97316'
        : multiplier === 3
          ? '#dc2626'
          : multiplier === 2
            ? '#ea580c'
            : '#15803d',
      life: 1.1,
      maxLife: 1.1,
    });

    if (kind === 'fishbowl') {
      floats.push({
        x: Math.max(54, Math.min(tuning.view.width - 54, x)),
        y: y - 38,
        text: '🐟 小金鱼逃生!',
        color: '#0284c7',
        life: 1.2,
        maxLife: 1.2,
      });
    }

    if (tuning.items[kind].heavy || multiplier >= 2) {
      shakeMag = Math.max(shakeMag, kind === 'fishbowl' || kind === 'kettle' ? 9 : 5.5);
    }
  }

  function computeMoveDir(): -1 | 0 | 1 {
    let dir = 0;
    if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) dir -= 1;
    if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) dir += 1;
    if (dir === 0 && movePointerActive) {
      dir = movePointerSide;
    }
    if (dir < 0) return -1;
    if (dir > 0) return 1;
    return 0;
  }

  function onPointerDown(e: PointerEvent): void {
    sound.unlock();
    const pt = toLogicalCoords(e.clientX, e.clientY);

    if (screenMode === 'title') {
      // 双模式切换
      if (pt.y >= 168 && pt.y <= 200) {
        if (pt.x >= 40 && pt.x <= 190) {
          gameMode = 'story';
          return;
        }
        if (pt.x >= 200 && pt.x <= 350) {
          gameMode = 'endless';
          return;
        }
      }
      // 4 关选关
      if (gameMode === 'story' && pt.y >= 214 && pt.y <= 276) {
        STAGE_IDS.forEach((id, idx) => {
          const sx = 34 + idx * 82;
          if (pt.x >= sx && pt.x <= sx + 76 && id <= progress.unlockedStage) {
            stageId = id;
          }
        });
        return;
      }
      // 开始按钮
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 416 && pt.y <= 468) {
        startNewGame(stageId);
      }
      return;
    }

    if (screenMode === 'result') {
      const passedStory =
        gameMode === 'story' &&
        steward.endReason !== 'hearts_zero' &&
        bill.totalScore >= STAGES[stageId].targetScore;
      if (passedStory && stageId < 4 && pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 404 && pt.y <= 452) {
        startNewGame((stageId + 1) as StageId);
        return;
      }
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 462 && pt.y <= 512) {
        startNewGame(stageId);
      }
      return;
    }

    // 静音按钮
    if (Math.hypot(pt.x - (tuning.view.width - 30), pt.y - 38) <= 22) {
      sound.muted = !sound.muted;
      return;
    }

    // 右下角「轻拍! (Space)」独立多指触控按钮
    const tapBtn = tuning.buttons.tap;
    if (Math.hypot(pt.x - tapBtn.x, pt.y - tapBtn.y) <= tapBtn.r + 6) {
      tapQueued = true;
      return;
    }

    // 左右半区按住移动（不与轻拍按钮抢指针）
    movePointerActive = true;
    movePointerId = e.pointerId;
    movePointerSide = pt.x < tuning.view.width / 2 ? -1 : 1;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!movePointerActive || screenMode !== 'playing') return;
    if (movePointerId !== null && e.pointerId !== movePointerId) return;
    const pt = toLogicalCoords(e.clientX, e.clientY);
    movePointerSide = pt.x < tuning.view.width / 2 ? -1 : 1;
  }

  function onPointerUpOrCancel(e: PointerEvent): void {
    if (movePointerId !== null && e.pointerId !== movePointerId) return;
    movePointerActive = false;
    movePointerId = null;
    movePointerSide = 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    if (screenMode === 'title' && (e.code === 'Space' || e.code === 'Enter')) {
      startNewGame(stageId);
      return;
    }

    if (screenMode === 'result' && (e.code === 'KeyR' || e.code === 'Enter')) {
      startNewGame(stageId);
      return;
    }

    if (screenMode !== 'playing') return;

    sound.unlock();
    if (e.code === 'Space' && !e.repeat) {
      tapQueued = true;
    } else if (
      e.code === 'KeyA' ||
      e.code === 'ArrowLeft' ||
      e.code === 'KeyD' ||
      e.code === 'ArrowRight'
    ) {
      heldKeys.add(e.code);
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    heldKeys.delete(e.code);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUpOrCancel);
  canvas.addEventListener('pointercancel', onPointerUpOrCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInputs();
  });

  resizeCanvas();

  let lastTimeMs = performance.now();
  let accumulatorMs = 0;

  function stepSimulation(dtMs: number): void {
    const dtSec = dtMs / 1000;
    animTimeSec += dtSec;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dtSec;
      p.vy += 420 * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dtSec;
      f.y -= 34 * dtSec;
      if (f.life <= 0) floats.splice(i, 1);
    }

    shakeMag = Math.max(0, shakeMag - 28 * dtSec);

    if (screenMode !== 'playing') return;

    const moveDir = computeMoveDir();
    const didTap = tapQueued;
    tapQueued = false;
    if (didTap) {
      sound.playTapPaw();
    }

    const worldRes = world.step(moveDir, didTap, dtMs);
    if (worldRes.phoneBuzzed) {
      sound.playPhoneBuzz();
    }

    for (const drop of worldRes.droppedItems) {
      bill = recordItemDrop(bill, drop.kind, drop.multiplier, tuning, drop.brokeOnTable);
      sound.playCrash(drop.heavy);
      spawnDropEffects(
        drop.x,
        drop.y,
        drop.kind,
        drop.score,
        drop.multiplier,
        drop.brokeOnTable,
      );
    }

    if (worldRes.waveCleared) {
      if (gameMode === 'story' && bill.totalScore >= STAGES[stageId].targetScore) {
        finishMatch('stage_cleared');
        return;
      }
      waveNumber += 1;
      world.spawnWave(waveNumber, activeStageItems());
    }

    const prevPhase = steward.phase;
    const playerActive = moveDir !== 0 || didTap;
    const enableTeeterSuspicion =
      gameMode === 'story' ? STAGES[stageId].enableTeeterSuspicion : waveNumber >= 2;

    steward = stepSteward(
      steward,
      {
        dtSec,
        playerActive,
        hasMovingItem: worldRes.hasMovingItem,
        itemDroppedDuringStep: worldRes.droppedItems.length > 0,
        addedNoise: worldRes.addedNoise,
        hasTeeteringItem: worldRes.hasTeeteringItem,
        enableTeeterSuspicion,
      },
      tuning,
    );

    if (prevPhase !== 'WARNING' && steward.phase === 'WARNING') {
      sound.playWarningTick();
    }
    if (prevPhase !== 'CAUGHT' && steward.phase === 'CAUGHT') {
      sound.playCaught();
      shakeMag = Math.max(shakeMag, 8);
    }

    if (steward.finished) {
      finishMatch(steward.endReason);
    }
  }

  function frame(nowMs: number): void {
    const elapsed = Math.min(tuning.loop.maxFrameDtMs, Math.max(0, nowMs - lastTimeMs));
    lastTimeMs = nowMs;
    accumulatorMs += elapsed;

    while (accumulatorMs >= tuning.loop.fixedDtMs) {
      stepSimulation(tuning.loop.fixedDtMs);
      accumulatorMs -= tuning.loop.fixedDtMs;
    }

    const shakeX = shakeMag > 0.2 ? (Math.random() - 0.5) * shakeMag * 2 : 0;
    const shakeY = shakeMag > 0.2 ? (Math.random() - 0.5) * shakeMag * 2 : 0;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGameFrame(
      ctx,
      world,
      {
        screenMode,
        gameMode,
        stageId,
        progress,
        steward,
        bill,
        muted: sound.muted,
        debug: debugMode,
        shakeX,
        shakeY,
        particles,
        floats,
        animTimeSec,
      },
      tuning,
    );
    ctx.restore();

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}

main();
