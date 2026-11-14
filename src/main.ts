import './style.css';
import {
  CAT_SKIN_IDS,
  CODEX_ENTRIES,
  UPGRADE_IDS,
} from './config/progression';
import { STAGES, STAGE_IDS, type GameMode, type StageId } from './config/stages';
import { tuning, type DifficultyMode, type ItemKind } from './config/tuning';
import { SoundEngine } from './game/audio';
import {
  calculateCanCoinsReward,
  createInitialProgression,
  getEffectiveStats,
  purchaseOrEquipSkin,
  purchaseUpgrade,
  recordCodexDrops,
  sanitizeProgression,
  type ProgressionState,
} from './game/progression';
import {
  applyEndlessResult,
  applyStageResult,
  createBillSummary,
  createInitialProgress,
  createStewardState,
  evaluateStageStars,
  evaluateVersusOutcome,
  evaluateVersusWatch,
  recordItemDrop,
  shouldAdvanceSimulation,
  stepSteward,
  triggerMeowCharm,
  type BillSummary,
  type DifficultyProgress,
  type ScreenMode,
  type StageProgress,
  type StewardState,
} from './game/rules';
import { CatPushWorld } from './game/world';
import { drawGameFrame, type FloatingText, type Particle } from './render/painter';

const PROGRESS_KEY = 'cat_push_progress_v3';
const LEGACY_PROGRESS_KEY_V2 = 'cat_push_progress_v2';
const PROGRESSION_KEY = 'cat_push_progression_v1';

function sanitizeDifficultyProgress(
  raw: Partial<DifficultyProgress> | undefined,
  fallback: DifficultyProgress,
): DifficultyProgress {
  if (!raw) return fallback;
  return {
    unlockedStage:
      raw.unlockedStage && raw.unlockedStage >= 1 && raw.unlockedStage <= 4
        ? raw.unlockedStage
        : fallback.unlockedStage,
    stars: { ...fallback.stars, ...(raw.stars ?? {}) },
    bestScores: { ...fallback.bestScores, ...(raw.bestScores ?? {}) },
    endlessBestScore:
      typeof raw.endlessBestScore === 'number' && raw.endlessBestScore > 0
        ? raw.endlessBestScore
        : 0,
  };
}

function readProgress(): StageProgress {
  const base = createInitialProgress();
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StageProgress>;
      return {
        byDifficulty: {
          easy: sanitizeDifficultyProgress(parsed.byDifficulty?.easy, base.byDifficulty.easy),
          normal: sanitizeDifficultyProgress(parsed.byDifficulty?.normal, base.byDifficulty.normal),
          hard: sanitizeDifficultyProgress(parsed.byDifficulty?.hard, base.byDifficulty.hard),
        },
      };
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_PROGRESS_KEY_V2);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw) as Partial<DifficultyProgress>;
      return {
        byDifficulty: {
          ...base.byDifficulty,
          normal: sanitizeDifficultyProgress(legacyParsed, base.byDifficulty.normal),
        },
      };
    }
    return base;
  } catch {
    return base;
  }
}

function writeProgress(progress: StageProgress): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage failures in restricted contexts
  }
}

function readProgression(): ProgressionState {
  try {
    const raw = window.localStorage.getItem(PROGRESSION_KEY);
    if (!raw) return createInitialProgression();
    return sanitizeProgression(JSON.parse(raw));
  } catch {
    return createInitialProgression();
  }
}

function writeProgression(progression: ProgressionState): void {
  try {
    window.localStorage.setItem(PROGRESSION_KEY, JSON.stringify(progression));
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
  let progression = readProgression();
  let gameMode: GameMode = 'story';
  let difficulty: DifficultyMode = 'easy';
  let stageId: StageId = 1;
  let world = new CatPushWorld(tuning, STAGES[stageId].items);
  let steward: StewardState = createStewardState(tuning, difficulty);
  let bill: BillSummary = createBillSummary();
  let screenMode: ScreenMode = 'title';
  let shopTab: 'upgrades' | 'skins' = 'upgrades';
  let selectedCodexKind: ItemKind = 'tissue';
  let lastEarnedCoins = 0;
  let newlyCompletedCodex = false;
  let rivalBillScore = 0;
  let roundBlameShifts = 0;
  let blameToastText: string | null = null;
  let blameToastSec = 0;
  let waveNumber = 1;
  const restoredThisWatch = new Set<number>();

  const particles: Particle[] = [];
  const floats: FloatingText[] = [];
  let shakeMag = 0;
  let animTimeSec = 0;

  let movePointerActive = false;
  let movePointerId: number | null = null;
  let movePointerSide: -1 | 0 | 1 = 0;
  let movePointerStartY = 0;
  let dpadPointerId: number | null = null;
  let dpadMoveDir: -1 | 0 | 1 = 0;
  const heldKeys = new Set<string>();
  let tapQueued = false;
  let jumpQueued = false;
  let meowQueued = false;

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
    dpadPointerId = null;
    dpadMoveDir = 0;
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
    world = new CatPushWorld(tuning, items, gameMode === 'versus');
    waveNumber = 1;
    world.spawnWave(waveNumber, items);
    steward = createStewardState(tuning, difficulty);
    bill = createBillSummary();
    rivalBillScore = 0;
    roundBlameShifts = 0;
    blameToastText = null;
    blameToastSec = 0;
    restoredThisWatch.clear();
    particles.length = 0;
    floats.length = 0;
    shakeMag = 0;
    clearInputs();
    accumulatorMs = 0;
    lastTimeMs = performance.now();
    screenMode = 'playing';
  }

  function exitToTitle(): void {
    const items = activeStageItems();
    world = new CatPushWorld(tuning, items, gameMode === 'versus');
    waveNumber = 1;
    steward = createStewardState(tuning, difficulty);
    bill = createBillSummary();
    rivalBillScore = 0;
    roundBlameShifts = 0;
    blameToastText = null;
    blameToastSec = 0;
    restoredThisWatch.clear();
    particles.length = 0;
    floats.length = 0;
    shakeMag = 0;
    clearInputs();
    accumulatorMs = 0;
    lastTimeMs = performance.now();
    screenMode = 'title';
  }

  function togglePause(): void {
    if (screenMode === 'playing') {
      clearInputs();
      screenMode = 'paused';
    } else if (screenMode === 'paused') {
      clearInputs();
      accumulatorMs = 0;
      lastTimeMs = performance.now();
      screenMode = 'playing';
    }
  }

  function finishMatch(endReason: StewardState['endReason']): void {
    steward = { ...steward, finished: true, endReason };
    screenMode = 'result';
    clearInputs();
    let stars: 0 | 1 | 2 | 3 = 0;
    let passedStory = false;
    let versusWin = false;
    if (gameMode === 'story') {
      const target = STAGES[stageId].targetScore;
      stars =
        endReason === 'hearts_zero' ? 0 : evaluateStageStars(bill.totalScore, target, steward.hearts);
      passedStory = stars > 0;
      progress = applyStageResult(progress, difficulty, stageId, bill.totalScore, stars);
    } else if (gameMode === 'versus') {
      versusWin =
        endReason !== 'hearts_zero' && evaluateVersusOutcome(bill.totalScore, rivalBillScore) === 'win';
      progress = applyEndlessResult(progress, difficulty, bill.totalScore);
    } else {
      progress = applyEndlessResult(progress, difficulty, bill.totalScore);
    }

    lastEarnedCoins = calculateCanCoinsReward({
      totalScore: bill.totalScore,
      dropCount: bill.records.length,
      passedStory,
      stars,
      difficulty,
      versusWin,
    });
    progression = {
      ...progression,
      canCoins: progression.canCoins + lastEarnedCoins,
      versusWins: progression.versusWins + (versusWin ? 1 : 0),
      blameShiftCount: progression.blameShiftCount + roundBlameShifts,
    };
    const codexRes = recordCodexDrops(progression, bill.records);
    progression = codexRes.state;
    newlyCompletedCodex = codexRes.newlyCompletedCodex;

    writeProgress(progress);
    writeProgression(progression);
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

    const prefix =
      gameMode === 'versus'
        ? brokeOnTable
          ? '我方摔碎 +¥'
          : '我方 +¥'
        : brokeOnTable
          ? '提前摔碎 +¥'
          : '+¥';
    const multLabel = !brokeOnTable && multiplier > 1 ? ` ×${multiplier}!` : gameMode === 'versus' ? '！' : '';
    const floatY = Math.min(y - 16, tuning.scene.tableTopY + 15);
    floats.push({
      x: Math.max(66, Math.min(tuning.view.width - 66, x)),
      y: floatY,
      text: `${prefix}${score}${multLabel}`,
      color:
        gameMode === 'versus'
          ? '#fbbf24'
          : brokeOnTable
            ? '#f97316'
            : multiplier === 3
              ? '#dc2626'
              : multiplier === 2
                ? '#ea580c'
                : '#15803d',
      life: 1.15,
      maxLife: 1.15,
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
    if (dir === 0 && dpadPointerId !== null) {
      dir = dpadMoveDir;
    }
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
      // 三模式切换 (y: 128..158)
      if (pt.y >= 128 && pt.y <= 158) {
        if (pt.x >= 36 && pt.x <= 136) {
          gameMode = 'story';
          return;
        }
        if (pt.x >= 146 && pt.x <= 246) {
          gameMode = 'endless';
          return;
        }
        if (pt.x >= 256 && pt.x <= 356) {
          gameMode = 'versus';
          return;
        }
      }
      // 3 档难度切换 (y: 168..196)
      if (pt.y >= 168 && pt.y <= 196) {
        let nextDiff: DifficultyMode | null = null;
        if (pt.x >= 40 && pt.x <= 140) nextDiff = 'easy';
        else if (pt.x >= 145 && pt.x <= 245) nextDiff = 'normal';
        else if (pt.x >= 250 && pt.x <= 350) nextDiff = 'hard';
        if (nextDiff) {
          difficulty = nextDiff;
          if (stageId > progress.byDifficulty[difficulty].unlockedStage) {
            stageId = progress.byDifficulty[difficulty].unlockedStage;
          }
          return;
        }
      }
      // 4 关选关 (y: 226..286)
      if (gameMode === 'story' && pt.y >= 226 && pt.y <= 286) {
        const unlockedStage = progress.byDifficulty[difficulty].unlockedStage;
        STAGE_IDS.forEach((id, idx) => {
          const sx = 34 + idx * 82;
          if (pt.x >= sx && pt.x <= sx + 76 && id <= unlockedStage) {
            stageId = id;
          }
        });
        return;
      }
      // 开始按钮 (y: 418..466)
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 418 && pt.y <= 466) {
        startNewGame(stageId);
        return;
      }
      // 商店与图鉴入口 (y: 478..518)
      if (pt.y >= 478 && pt.y <= 518) {
        if (pt.x >= 38 && pt.x <= 190) {
          screenMode = 'shop';
          return;
        }
        if (pt.x >= 200 && pt.x <= 352) {
          screenMode = 'codex';
          return;
        }
      }
      return;
    }

    if (screenMode === 'shop') {
      // 页签切换 (y: 96..126)
      if (pt.y >= 96 && pt.y <= 126) {
        if (pt.x >= 36 && pt.x <= 190) {
          shopTab = 'upgrades';
          return;
        }
        if (pt.x >= 200 && pt.x <= 354) {
          shopTab = 'skins';
          return;
        }
      }
      // 购买/穿戴按钮 (x: 256..342)
      if (pt.x >= 256 && pt.x <= 342) {
        for (let idx = 0; idx < 4; idx++) {
          const btnTop = 138 + idx * 94 + 22;
          if (pt.y >= btnTop && pt.y <= btnTop + 40) {
            if (shopTab === 'upgrades') {
              const res = purchaseUpgrade(progression, UPGRADE_IDS[idx]);
              if (res.purchased) {
                progression = res.state;
                writeProgression(progression);
                sound.playMeow();
              }
            } else {
              const res = purchaseOrEquipSkin(progression, CAT_SKIN_IDS[idx]);
              if (res.changed) {
                progression = res.state;
                writeProgression(progression);
                sound.playMeow();
              }
            }
            return;
          }
        }
      }
      // 返回封面 (y: 528..574)
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 528 && pt.y <= 574) {
        screenMode = 'title';
      }
      return;
    }

    if (screenMode === 'codex') {
      // 3x5 图鉴格子点击
      for (let idx = 0; idx < CODEX_ENTRIES.length; idx++) {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const gx = 32 + col * 110;
        const gy = 88 + row * 60;
        if (pt.x >= gx && pt.x <= gx + 104 && pt.y >= gy && pt.y <= gy + 54) {
          selectedCodexKind = CODEX_ENTRIES[idx].kind;
          return;
        }
      }
      // 返回封面 (y: 528..574)
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64 && pt.y >= 528 && pt.y <= 574) {
        screenMode = 'title';
      }
      return;
    }

    if (screenMode === 'paused') {
      if (pt.x >= 68 && pt.x <= tuning.view.width - 68) {
        if (pt.y >= 258 && pt.y <= 304) {
          togglePause();
          return;
        }
        if (pt.y >= 314 && pt.y <= 360) {
          startNewGame(stageId);
          return;
        }
        if (pt.y >= 370 && pt.y <= 416) {
          exitToTitle();
          return;
        }
      }
      return;
    }

    if (screenMode === 'result') {
      const passedStory =
        gameMode === 'story' &&
        steward.endReason !== 'hearts_zero' &&
        bill.totalScore >= STAGES[stageId].targetScore;
      const hasNextStage = passedStory && stageId < 4;
      if (pt.x >= 64 && pt.x <= tuning.view.width - 64) {
        if (hasNextStage) {
          if (pt.y >= 388 && pt.y <= 432) {
            startNewGame((stageId + 1) as StageId);
            return;
          }
          if (pt.y >= 440 && pt.y <= 484) {
            startNewGame(stageId);
            return;
          }
          if (pt.y >= 492 && pt.y <= 536) {
            exitToTitle();
            return;
          }
        } else {
          if (pt.y >= 416 && pt.y <= 464) {
            startNewGame(stageId);
            return;
          }
          if (pt.y >= 476 && pt.y <= 524) {
            exitToTitle();
            return;
          }
        }
      }
      return;
    }

    // 静音按钮 (width - 58, 38) 与暂停按钮 (width - 28, 38)
    if (Math.hypot(pt.x - (tuning.view.width - 58), pt.y - 38) <= 15) {
      sound.muted = !sound.muted;
      return;
    }
    if (Math.hypot(pt.x - (tuning.view.width - 28), pt.y - 38) <= 18) {
      togglePause();
      return;
    }

    // 左下角双拇指方向钮：◀ / ▶
    const { left: leftBtn, right: rightBtn, tap: tapBtn, jump: jumpBtn, meow: meowBtn } =
      tuning.buttons;
    if (Math.hypot(pt.x - leftBtn.x, pt.y - leftBtn.y) <= leftBtn.r + 8) {
      dpadPointerId = e.pointerId;
      dpadMoveDir = -1;
      return;
    }
    if (Math.hypot(pt.x - rightBtn.x, pt.y - rightBtn.y) <= rightBtn.r + 8) {
      dpadPointerId = e.pointerId;
      dpadMoveDir = 1;
      return;
    }

    // 右下角 3 个独立多指触控技能钮：轻拍! / 跳 / 喵~
    if (Math.hypot(pt.x - tapBtn.x, pt.y - tapBtn.y) <= tapBtn.r + 6) {
      tapQueued = true;
      return;
    }
    if (Math.hypot(pt.x - jumpBtn.x, pt.y - jumpBtn.y) <= jumpBtn.r + 6) {
      jumpQueued = true;
      return;
    }
    if (Math.hypot(pt.x - meowBtn.x, pt.y - meowBtn.y) <= meowBtn.r + 6) {
      meowQueued = true;
      return;
    }

    // 左右半区按住移动（不与技能按钮抢指针；向上轻划触发跳跃）
    movePointerActive = true;
    movePointerId = e.pointerId;
    movePointerSide = pt.x < tuning.view.width / 2 ? -1 : 1;
    movePointerStartY = pt.y;
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
    if (movePointerStartY - pt.y >= 42) {
      jumpQueued = true;
      movePointerStartY = pt.y;
    }
  }

  function onPointerUpOrCancel(e: PointerEvent): void {
    if (dpadPointerId !== null && e.pointerId === dpadPointerId) {
      dpadPointerId = null;
      dpadMoveDir = 0;
    }
    if (movePointerId !== null && e.pointerId !== movePointerId) return;
    movePointerActive = false;
    movePointerId = null;
    movePointerSide = 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) {
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

    if (screenMode === 'paused') {
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        togglePause();
      } else if (e.code === 'KeyR' && !e.repeat) {
        startNewGame(stageId);
      }
      return;
    }

    if (!shouldAdvanceSimulation(screenMode)) return;

    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
      togglePause();
      return;
    }

    sound.unlock();
    if (e.code === 'Space' && !e.repeat) {
      tapQueued = true;
    } else if ((e.code === 'KeyW' || e.code === 'ArrowUp') && !e.repeat) {
      jumpQueued = true;
    } else if (e.code === 'KeyE' && !e.repeat) {
      meowQueued = true;
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
    blameToastSec = Math.max(0, blameToastSec - dtSec);

    if (!shouldAdvanceSimulation(screenMode)) return;

    const moveDir = computeMoveDir();
    const didTap = tapQueued;
    const didJump = jumpQueued && world.cat.jumpTimerSec <= 0;
    const didMeow = meowQueued;
    tapQueued = false;
    jumpQueued = false;
    meowQueued = false;

    const stats = getEffectiveStats(progression);

    if (didTap) {
      sound.playTapPaw();
    }
    if (didJump) {
      sound.playJump();
    }
    if (didMeow) {
      const charmRes = triggerMeowCharm(
        steward,
        tuning,
        stats.meowCooldownSec,
        stats.meowCharmBonusSec,
      );
      if (charmRes.triggered) {
        steward = charmRes.state;
        world.cat.meowBubbleSec = 1.25;
        sound.playMeow();
        if (charmRes.interruptedSteward) {
          floats.push({
            x: world.cat.x,
            y: tuning.scene.tableTopY - 72,
            text: '卖萌打断成功!',
            color: '#ec4899',
            life: 1.0,
            maxLife: 1.0,
          });
        }
      }
    }

    const worldRes = world.step(
      moveDir,
      didTap,
      didJump,
      dtMs,
      difficulty,
      restoredThisWatch,
      stats,
      steward.phase,
    );
    if (worldRes.phoneBuzzed) {
      sound.playPhoneBuzz();
    }
    if (worldRes.interceptedRival) {
      floats.push({
        x: world.cat.x,
        y: tuning.scene.tableTopY - 68,
        text: '⚡ 截胡！',
        color: '#fbbf24',
        life: 0.95,
        maxLife: 0.95,
      });
    }
    if (worldRes.shovedRival) {
      floats.push({
        x: world.rival.x,
        y: tuning.scene.tableTopY - 58,
        text: '💥 顶开!',
        color: '#fb923c',
        life: 0.85,
        maxLife: 0.85,
      });
    }

    for (const drop of worldRes.droppedItems) {
      if (drop.owner === 'rival' && gameMode === 'versus') {
        rivalBillScore += drop.score;
        sound.playCrash(drop.heavy);
        floats.push({
          x: Math.max(66, Math.min(tuning.view.width - 66, drop.x)),
          y: Math.min(drop.y - 16, tuning.scene.tableTopY + 15),
          text: `白猫 +¥${drop.score}`,
          color: '#38bdf8',
          life: 1.15,
          maxLife: 1.15,
        });
        continue;
      }
      bill = recordItemDrop(
        bill,
        drop.kind,
        drop.multiplier,
        tuning,
        drop.brokeOnTable,
        stats.teeterScoreMultiplier,
      );
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

    let effectivePlayerActive = playerActive;
    let effectiveHasMovingItem = worldRes.hasMovingItem;
    let effectiveItemDropped = worldRes.droppedItems.length > 0;

    if (gameMode === 'versus' && steward.phase === 'WATCHING') {
      const watchRes = evaluateVersusWatch({
        playerActive,
        rivalActive: worldRes.rivalActive,
        movingOwners: worldRes.movingOwners,
        droppedOwners: worldRes.droppedOwners,
        rivalStunSec: world.rival.stunSec,
      });
      if (watchRes.blameShifted) {
        world.rival.stunSec = tuning.versus.rivalStunSec;
        rivalBillScore = Math.max(0, rivalBillScore - tuning.versus.blameDeduction);
        roundBlameShifts += 1;
        blameToastText = '🔥 甩锅成功！小白猫背锅 -¥80 罚站 2.5s！';
        blameToastSec = 2.5;
        sound.playMeow();
        floats.push({
          x: tuning.view.width / 2,
          y: tuning.scene.tableTopY - 126,
          text: '小白猫！又是你干的！',
          color: '#dc2626',
          life: 2.0,
          maxLife: 2.0,
        });
        steward = {
          ...steward,
          phase: 'RELAXED',
          phaseTimerSec: tuning.steward.watchMaxSec,
        };
        effectivePlayerActive = false;
        effectiveHasMovingItem = false;
        effectiveItemDropped = false;
      } else if (!watchRes.playerCaught) {
        effectivePlayerActive = false;
        effectiveHasMovingItem = false;
        effectiveItemDropped = false;
      }
    }

    steward = stepSteward(
      steward,
      {
        dtSec,
        playerActive: effectivePlayerActive,
        hasMovingItem: effectiveHasMovingItem,
        itemDroppedDuringStep: effectiveItemDropped,
        addedNoise: worldRes.addedNoise,
        hasTeeteringItem: worldRes.hasTeeteringItem,
        teeteringItemLabel: worldRes.teeteringItemLabel,
        restoreCandidate: worldRes.restoreCandidate,
        enableTeeterSuspicion,
        warningBonusSec: stats.warningBonusSec,
      },
      tuning,
    );

    if (steward.phase !== 'WATCHING') {
      restoredThisWatch.clear();
    }

    if (steward.lastRestoredId !== null) {
      restoredThisWatch.add(steward.lastRestoredId);
      const restored = world.restoreItemById(steward.lastRestoredId, difficulty);
      if (restored) {
        floats.push({
          x: restored.body.position.x,
          y: tuning.scene.tableTopY - restored.spec.height - 16,
          text: `${restored.spec.label}被摆回原位!`,
          color: '#f59e0b',
          life: 1.1,
          maxLife: 1.1,
        });
      }
    }

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
        difficulty,
        stageId,
        progress,
        progression,
        shopTab,
        selectedCodexKind,
        lastEarnedCoins,
        newlyCompletedCodex,
        steward,
        bill,
        muted: sound.muted,
        debug: debugMode,
        shakeX,
        shakeY,
        particles,
        floats,
        animTimeSec,
        rivalBillScore,
        blameShiftCount: roundBlameShifts,
        blameToastText,
        blameToastSec,
      },
      tuning,
    );
    ctx.restore();

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}

main();
