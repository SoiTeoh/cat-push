import './style.css';
import { tuning, type ItemKind } from './config/tuning';
import { SoundEngine } from './game/audio';
import {
  createBillSummary,
  createStewardState,
  recordItemDrop,
  stepSteward,
  type BillSummary,
  type StewardState,
} from './game/rules';
import { CatPushWorld } from './game/world';
import { drawGameFrame, type FloatingText, type Particle } from './render/painter';

const BEST_SCORE_KEY = 'cat_push_best_score_v1';

function readBestScore(): number {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeBestScore(score: number): void {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(Math.max(0, Math.floor(score))));
  } catch {
    // Ignore storage failures in restricted contexts
  }
}

function itemColor(kind: ItemKind): string {
  switch (kind) {
    case 'tissue':
      return '#f8fafc';
    case 'pen':
      return '#ef4444';
    case 'mug':
      return '#93c5fd';
    case 'kettle':
      return '#cbd5e1';
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
  let world = new CatPushWorld(tuning);
  let steward: StewardState = createStewardState(tuning);
  let bill: BillSummary = createBillSummary();
  let bestScore = readBestScore();
  let screenMode: 'title' | 'playing' | 'result' = 'title';
  let waveNumber = 1;

  const particles: Particle[] = [];
  const floats: FloatingText[] = [];
  let shakeMag = 0;
  let animTimeSec = 0;

  let pointerActive = false;
  let pointerId: number | null = null;
  let pointerSide: -1 | 0 | 1 = 0;
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
    pointerActive = false;
    pointerId = null;
    pointerSide = 0;
    heldKeys.clear();
    tapQueued = false;
  }

  function startNewGame(): void {
    sound.unlock();
    world = new CatPushWorld(tuning);
    waveNumber = 1;
    world.spawnWave(waveNumber);
    steward = createStewardState(tuning);
    bill = createBillSummary();
    particles.length = 0;
    floats.length = 0;
    shakeMag = 0;
    clearInputs();
    screenMode = 'playing';
  }

  function spawnDropEffects(x: number, kind: ItemKind, totalScore: number, multiplier: 1 | 2 | 3): void {
    const y = tuning.scene.floorY - 10;
    const count = kind === 'kettle' ? 18 : kind === 'mug' ? 14 : 9;
    const baseColor = itemColor(kind);

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = 70 + Math.random() * 190;
      particles.push({
        x: x + (Math.random() - 0.5) * 18,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        r: 2.5 + Math.random() * 3.5,
        color: i % 3 === 0 ? '#fde68a' : baseColor,
        life: 0.55 + Math.random() * 0.25,
        maxLife: 0.8,
      });
    }

    const multLabel = multiplier > 1 ? ` ×${multiplier}!` : '';
    floats.push({
      x: Math.max(46, Math.min(tuning.view.width - 46, x)),
      y: y - 16,
      text: `+¥${totalScore}${multLabel}`,
      color: multiplier === 3 ? '#dc2626' : multiplier === 2 ? '#ea580c' : '#15803d',
      life: 1.05,
      maxLife: 1.05,
    });

    if (kind === 'kettle' || kind === 'mug' || multiplier >= 2) {
      shakeMag = Math.max(shakeMag, kind === 'kettle' ? 9 : 5.5);
    }
  }

  function computeMoveDir(): -1 | 0 | 1 {
    let dir = 0;
    if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) dir -= 1;
    if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) dir += 1;
    if (dir === 0 && pointerActive) {
      dir = pointerSide;
    }
    if (dir < 0) return -1;
    if (dir > 0) return 1;
    return 0;
  }

  function onPointerDown(e: PointerEvent): void {
    sound.unlock();
    const pt = toLogicalCoords(e.clientX, e.clientY);

    if (screenMode === 'title') {
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 408 && pt.y <= 458) {
        startNewGame();
      }
      return;
    }

    if (screenMode === 'result') {
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 434 && pt.y <= 486) {
        startNewGame();
      }
      return;
    }

    // Mute button top-right
    const muteDist = Math.hypot(pt.x - (tuning.view.width - 32), pt.y - 38);
    if (muteDist <= 22) {
      sound.muted = !sound.muted;
      return;
    }

    pointerActive = true;
    pointerId = e.pointerId;
    pointerSide = pt.x < tuning.view.width / 2 ? -1 : 1;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer capture
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerActive || screenMode !== 'playing') return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const pt = toLogicalCoords(e.clientX, e.clientY);
    pointerSide = pt.x < tuning.view.width / 2 ? -1 : 1;
  }

  function onPointerUpOrCancel(e: PointerEvent): void {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    pointerActive = false;
    pointerId = null;
    pointerSide = 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    if (screenMode === 'title' && (e.code === 'Space' || e.code === 'Enter')) {
      startNewGame();
      return;
    }

    if (screenMode === 'result' && (e.code === 'KeyR' || e.code === 'Enter')) {
      startNewGame();
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

    // Update particles & floating damage numbers even on result screen
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
    for (const drop of worldRes.droppedItems) {
      bill = recordItemDrop(bill, drop.kind, drop.multiplier, tuning);
      sound.playCrash(drop.kind === 'kettle' || drop.kind === 'mug');
      spawnDropEffects(
        drop.x,
        drop.kind,
        tuning.items[drop.kind].baseScore * drop.multiplier,
        drop.multiplier,
      );
    }

    if (worldRes.waveCleared) {
      waveNumber += 1;
      world.spawnWave(waveNumber);
    }

    const prevPhase = steward.phase;
    const playerActive = moveDir !== 0 || didTap;
    steward = stepSteward(
      steward,
      {
        dtSec,
        playerActive,
        hasMovingItem: worldRes.hasMovingItem,
        itemDroppedDuringStep: worldRes.droppedItems.length > 0,
        addedNoise: worldRes.addedNoise,
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
      screenMode = 'result';
      clearInputs();
      if (bill.totalScore > bestScore) {
        bestScore = bill.totalScore;
        writeBestScore(bestScore);
      }
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
        steward,
        bill,
        bestScore,
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
