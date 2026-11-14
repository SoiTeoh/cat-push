import Matter from 'matter-js';
import { STAGES } from '../config/stages';
import {
  tuning,
  type DifficultyMode,
  type ItemKind,
  type ItemSpec,
  type Tuning,
} from '../config/tuning';
import type { EffectiveStats } from './progression';
import {
  buildWaveLayout,
  calculateDropScore,
  clamp,
  computeRestoredX,
  computeRivalWarningReactionSec,
  decideRivalAction,
  evaluateTeeterState,
  isFragileBrokenOnTable,
  isItemOwnershipLocked,
  pickRestoreTarget,
  resolveCatGroundSeparation,
  resolveDropOwner,
  shouldBlockCatHorizontally,
  stepCatJump,
  stepPhoneBuzz,
  type CatActor,
  type DisplacedItemSnapshot,
  type StewardPhase,
  type TeeterTier,
} from './rules';

export interface TableItem {
  readonly id: number;
  readonly kind: ItemKind;
  readonly spec: ItemSpec;
  readonly body: Matter.Body;
  readonly originX: number;
  teeterHoldSec: number;
  teeterTier: TeeterTier;
  multiplier: 1 | 2 | 3;
  dropped: boolean;
  settledAfterDrop: boolean;
  buzzCycleSec: number;
  isBuzzing: boolean;
  restoreGraceSec: number;
  tapCoastSec: number;
  lastTouchedBy: CatActor | null;
  lastTouchedAgeSec: number;
}

export interface CatState {
  x: number;
  facing: 1 | -1;
  /** 0 = 趴平装睡, 1 = 清醒抬爪 */
  alertness: number;
  /** 松手计时，>= napTransitionSec 进入装睡 */
  idleSec: number;
  /** 0..1 伸爪推物动画进度 */
  pawExtend: number;
  /** 是否有有效输入（移动或轻拍） */
  isActive: boolean;
  /** 是否正用力推重物 */
  pushingHeavy: boolean;
  tapCooldownSec: number;
  jumpTimerSec: number;
  jumpHeightPx: number;
  autoHopVx: number;
  meowBubbleSec: number;
}

export interface RivalCatState {
  x: number;
  facing: 1 | -1;
  alertness: number;
  isActive: boolean;
  pawExtend: number;
  tapCooldownSec: number;
  stunSec: number;
  tapStunSec: number;
  shoveArcSec: number;
  angrySec: number;
  reactionTimerSec: number;
  prevStewardPhase: StewardPhase;
}

export interface DroppedNotice {
  readonly kind: ItemKind;
  readonly x: number;
  readonly y: number;
  readonly multiplier: 1 | 2 | 3;
  readonly score: number;
  readonly heavy: boolean;
  readonly brokeOnTable: boolean;
  readonly owner: CatActor;
}

export interface WorldStepResult {
  readonly droppedItems: readonly DroppedNotice[];
  readonly addedNoise: number;
  readonly hasMovingItem: boolean;
  readonly movingOwners: readonly CatActor[];
  readonly droppedOwners: readonly CatActor[];
  readonly hasTeeteringItem: boolean;
  readonly teeteringItemLabel: string | null;
  readonly restoreCandidate: DisplacedItemSnapshot | null;
  readonly waveCleared: boolean;
  readonly phoneBuzzed: boolean;
  readonly rivalActive: boolean;
  readonly interceptedRival: boolean;
  readonly shovedRival: boolean;
}

export class CatPushWorld {
  public readonly engine: Matter.Engine;
  public readonly tableBody: Matter.Body;
  public readonly floorSensor: Matter.Body;
  public readonly items: TableItem[] = [];
  public readonly cat: CatState;
  public readonly rival: RivalCatState;
  public readonly versusMode: boolean;
  public waveCount = 1;

  private nextItemId = 1;

  constructor(
    private readonly t: Tuning = tuning,
    initialItems: readonly ItemKind[] = STAGES[1].items,
    versusMode = false,
  ) {
    this.versusMode = versusMode;
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.15, scale: 0.001 },
      positionIterations: 8,
      velocityIterations: 6,
    });

    const { tableLeftX, tableEdgeX, tableTopY, tableThickness, floorY, leftWallX } =
      this.t.scene;
    const tableWidth = tableEdgeX - tableLeftX;

    this.tableBody = Matter.Bodies.rectangle(
      tableLeftX + tableWidth / 2,
      tableTopY + tableThickness / 2,
      tableWidth,
      tableThickness,
      {
        isStatic: true,
        label: 'table',
        friction: 0.5,
        frictionStatic: 0.65,
        restitution: 0.05,
      },
    );

    const leftWall = Matter.Bodies.rectangle(leftWallX / 2, tableTopY - 120, leftWallX, 320, {
      isStatic: true,
      label: 'left-wall',
      friction: 0.2,
    });

    this.floorSensor = Matter.Bodies.rectangle(
      this.t.view.width / 2,
      floorY + 14,
      this.t.view.width * 1.6,
      28,
      {
        isStatic: true,
        isSensor: true,
        label: 'floor-sensor',
      },
    );

    Matter.Composite.add(this.engine.world, [this.tableBody, leftWall, this.floorSensor]);

    this.cat = {
      x: versusMode ? 88 : this.t.cat.startX,
      facing: 1,
      alertness: 0,
      idleSec: this.t.cat.napTransitionSec,
      pawExtend: 0,
      isActive: false,
      pushingHeavy: false,
      tapCooldownSec: 0,
      jumpTimerSec: 0,
      jumpHeightPx: 0,
      autoHopVx: 0,
      meowBubbleSec: 0,
    };

    this.rival = {
      x: versusMode ? this.t.cat.minX : 92,
      facing: 1,
      alertness: 0.9,
      isActive: false,
      pawExtend: 0,
      tapCooldownSec: 0,
      stunSec: 0,
      tapStunSec: 0,
      shoveArcSec: 0,
      angrySec: 0,
      reactionTimerSec: 0.5,
      prevStewardPhase: 'RELAXED',
    };

    this.spawnWave(1, initialItems);
  }

  public spawnWave(
    waveNumber: number,
    stageItems: readonly ItemKind[] = STAGES[1].items,
  ): void {
    for (const item of this.items) {
      Matter.Composite.remove(this.engine.world, item.body);
    }
    this.items.length = 0;
    this.waveCount = waveNumber;

    const layout = buildWaveLayout(waveNumber, stageItems, this.t.scene.tableEdgeX, Math.random, this.t);
    for (const slot of layout) {
      this.spawnItem(slot.kind, slot.x);
    }
  }

  public spawnItem(kind: ItemKind, x: number): TableItem {
    const spec = this.t.items[kind];
    const spawnY = this.t.scene.tableTopY - spec.height / 2 - 0.1;

    const common: Matter.IBodyDefinition = {
      label: `item:${kind}`,
      density: spec.density,
      friction: spec.friction,
      frictionStatic: spec.frictionStatic,
      frictionAir: spec.frictionAir,
      restitution: spec.restitution,
      slop: 0.01,
    };

    let body: Matter.Body;
    if (kind === 'pen' || kind === 'lipstick') {
      body = Matter.Bodies.circle(x, spawnY, spec.width / 2, common);
    } else if (kind === 'tissue') {
      body = Matter.Bodies.polygon(x, spawnY, 6, spec.width * 0.45, {
        ...common,
        chamfer: { radius: 3 },
      });
    } else {
      body = Matter.Bodies.rectangle(x, spawnY, spec.width, spec.height, {
        ...common,
        chamfer: { radius: spec.heavy ? 6 : 3 },
      });
    }

    Matter.Composite.add(this.engine.world, body);
    const item: TableItem = {
      id: this.nextItemId++,
      kind,
      spec,
      body,
      originX: x,
      teeterHoldSec: 0,
      teeterTier: 'safe',
      multiplier: 1,
      dropped: false,
      settledAfterDrop: false,
      buzzCycleSec: 0.8,
      isBuzzing: false,
      restoreGraceSec: 0,
      tapCoastSec: 0,
      lastTouchedBy: null,
      lastTouchedAgeSec: 0,
    };
    this.items.push(item);
    return item;
  }

  public restoreItemById(itemId: number, difficulty: DifficultyMode = 'normal'): TableItem | null {
    const item = this.items.find((it) => it.id === itemId && !it.dropped);
    if (!item) return null;
    const wasTeetering = item.multiplier >= 2 || item.teeterTier !== 'safe';
    let restoredX = computeRestoredX(
      item.body.position.x,
      item.originX,
      this.t.difficulties[difficulty].restorePullRatio,
    );
    if (wasTeetering) {
      restoredX = Math.min(restoredX, this.t.scene.tableEdgeX - 42);
    }
    Matter.Body.setPosition(item.body, {
      x: restoredX,
      y: this.t.scene.tableTopY - item.spec.height / 2 - 0.2,
    });
    Matter.Body.setVelocity(item.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(item.body, 0);
    Matter.Body.setAngle(item.body, 0);
    item.teeterHoldSec = 0;
    item.teeterTier = 'safe';
    item.multiplier = 1;
    item.restoreGraceSec = 0.65;
    item.lastTouchedBy = null;
    item.lastTouchedAgeSec = 0;
    return item;
  }

  /**
   * 推进一步固定物理步长：
   * moveDir: -1(左) | 0(停/装睡) | 1(右推)
   * tapTriggered: 是否触发一次高风险“快速轻拍”
   * jumpTriggered: 是否触发一次“轻跳跨越”
   */
  public step(
    moveDir: -1 | 0 | 1,
    tapTriggered: boolean,
    jumpTriggered: boolean,
    dtMs: number,
    difficulty: DifficultyMode = 'normal',
    excludeRestoreIds?: ReadonlySet<number>,
    stats?: Partial<EffectiveStats>,
    stewardPhase: StewardPhase = 'RELAXED',
  ): WorldStepResult {
    const dtSec = dtMs / 1000;
    const pawMult = stats?.pawMultiplier ?? 1;
    const heavyMult = stats?.heavySpeedMultiplier ?? 1;
    const noiseFactor = stats?.noiseFactor ?? 1;
    const teeterScoreMult = stats?.teeterScoreMultiplier ?? 1;
    let addedNoise = 0;
    let pushingAny = false;
    let pushingHeavy = false;
    let phoneBuzzed = false;
    let interceptedRival = false;
    let shovedRival = false;

    this.cat.tapCooldownSec = Math.max(0, this.cat.tapCooldownSec - dtSec);
    this.cat.meowBubbleSec = Math.max(0, this.cat.meowBubbleSec - dtSec);

    const wasAirborne = this.cat.jumpTimerSec > 0;
    const jumpRes = stepCatJump(this.cat.jumpTimerSec, jumpTriggered, dtSec, this.t);
    this.cat.jumpTimerSec = jumpRes.nextJumpTimerSec;
    this.cat.jumpHeightPx = jumpRes.heightOffsetPx;

    // 单指/单鼠标点击「跳」且未按方向键时，若前方紧邻桌面物品则自动给予向右跨栏抛物线初速度
    if (!wasAirborne && jumpRes.isAirborne && moveDir === 0) {
      let hopVx = 0;
      for (const item of this.items) {
        if (item.dropped || item.body.position.y > this.t.scene.tableTopY + 12) continue;
        const leftEdge = item.body.position.x - item.spec.width * 0.5;
        const rightEdge = item.body.position.x + item.spec.width * 0.5;
        if (leftEdge - this.cat.x <= 48 && rightEdge >= this.cat.x) {
          hopVx = clamp(
            (item.spec.width + this.t.cat.bodyHalfW * 2 + 14) / this.t.cat.jumpDurationSec,
            175,
            250,
          );
          break;
        }
      }
      this.cat.autoHopVx = hopVx;
    } else if (!jumpRes.isAirborne) {
      this.cat.autoHopVx = 0;
    }

    const canTap = tapTriggered && this.cat.tapCooldownSec <= 0 && !jumpRes.isAirborne;
    if (canTap) {
      this.cat.tapCooldownSec = this.t.cat.tapCooldownSec;
      addedNoise += this.t.cat.tapNoiseSpike * noiseFactor;
    }

    const activeInput = moveDir !== 0 || canTap || jumpRes.isAirborne;
    this.cat.isActive = activeInput;

    if (activeInput) {
      this.cat.idleSec = 0;
      this.cat.alertness = clamp(this.cat.alertness + dtSec / 0.08, 0, 1);
      const effectiveVx =
        moveDir !== 0
          ? moveDir * this.t.cat.moveSpeed
          : jumpRes.isAirborne
            ? this.cat.autoHopVx
            : 0;
      if (moveDir !== 0) {
        this.cat.facing = moveDir;
      } else if (effectiveVx > 0) {
        this.cat.facing = 1;
      }
      if (effectiveVx !== 0) {
        let nextX = clamp(
          this.cat.x + effectiveVx * dtSec,
          this.t.cat.minX,
          this.t.cat.maxX,
        );
        // 仅在地面时受桌面物体水平阻挡；跳跃滞空期间直接越过障碍物
        for (const item of this.items) {
          if (item.dropped || item.body.position.y > this.t.scene.tableTopY + 12) continue;
          const leftEdge = item.body.position.x - item.spec.width * 0.5;
          if (
            shouldBlockCatHorizontally(
              this.cat.x,
              nextX,
              moveDir,
              jumpRes.isAirborne,
              leftEdge,
              item.body.position.x,
              this.t.cat.bodyHalfW,
            )
          ) {
            nextX = Math.min(nextX, Math.max(this.t.cat.minX, leftEdge - this.t.cat.bodyHalfW - 2));
          }
        }
        this.cat.x = nextX;
      }
    } else {
      this.cat.idleSec += dtSec;
      this.cat.alertness = clamp(
        1 - this.cat.idleSec / this.t.cat.napTransitionSec,
        0,
        1,
      );
    }

    // 落地防卡死引导：若恰好落在物体正上方，轻柔滑向最近的安全空隙
    if (wasAirborne && !jumpRes.isAirborne) {
      for (const item of this.items) {
        if (item.dropped || item.body.position.y > this.t.scene.tableTopY + 12) continue;
        const leftSafe = item.body.position.x - item.spec.width * 0.5 - this.t.cat.bodyHalfW - 2;
        const rightSafe = item.body.position.x + item.spec.width * 0.5 + this.t.cat.bodyHalfW + 2;
        if (this.cat.x > leftSafe && this.cat.x < rightSafe) {
          const distLeft = Math.abs(this.cat.x - leftSafe);
          const distRight = Math.abs(rightSafe - this.cat.x);
          this.cat.x = clamp(
            distRight <= distLeft && rightSafe <= this.t.cat.maxX ? rightSafe : leftSafe,
            this.t.cat.minX,
            this.t.cat.maxX,
          );
        }
      }
    }

    // 接触物品推力逻辑（仅在地面向右主动推或轻拍时施力）
    const pawX = this.cat.x + this.cat.facing * this.t.cat.pawReach;
    if (!jumpRes.isAirborne && (moveDir > 0 || canTap)) {
      for (const item of this.items) {
        if (item.dropped) continue;
        const b = item.body;
        if (b.position.y > this.t.scene.tableTopY + 12) continue;

        const halfW = item.spec.width * 0.5;
        const leftEdge = b.position.x - halfW;
        const rightEdge = b.position.x + halfW;

        const inPushZone =
          pawX >= leftEdge - 14 &&
          this.cat.x <= rightEdge - 2 &&
          b.position.x >= this.cat.x - 4;

        if (!inPushZone) continue;

        pushingAny = true;
        if (item.spec.heavy) {
          pushingHeavy = true;
        }

        if (canTap || moveDir > 0) {
          const locked = isItemOwnershipLocked(
            b.position.x,
            b.position.y,
            this.t.scene.tableEdgeX,
            this.t.scene.tableTopY,
          );
          if (!locked) {
            if (
              this.versusMode &&
              item.lastTouchedBy === 'rival' &&
              item.lastTouchedAgeSec <= this.t.versus.touchExpirySec
            ) {
              interceptedRival = true;
              this.rival.angrySec = Math.max(this.rival.angrySec, 1.5);
            }
            item.lastTouchedBy = 'player';
            item.lastTouchedAgeSec = 0;
          }
        }

        if (canTap) {
          item.tapCoastSec = 0.26;
          const itemBoost = pawMult * (item.spec.heavy ? heavyMult : 1);
          const tapSpeed = item.spec.heavy
            ? clamp((item.spec.maxNudgeSpeed * 2.2 + 0.55) * itemBoost, 0.85, 2.8 * itemBoost)
            : clamp(
                (item.spec.maxNudgeSpeed * 1.45 +
                  (this.t.cat.tapImpulseSpeedBoost * 0.001) / Math.max(item.spec.density, 0.0005)) *
                  itemBoost,
                1.4,
                6.2 * itemBoost,
              );
          Matter.Body.setVelocity(b, {
            x: Math.max(b.velocity.x, tapSpeed),
            y: b.velocity.y - (item.spec.heavy ? 0.18 : 0.35),
          });
        } else if (moveDir > 0) {
          const itemBoost = pawMult * (item.spec.heavy ? heavyMult : 1);
          const targetVx = item.spec.maxNudgeSpeed * itemBoost;
          if (b.velocity.x < targetVx) {
            const accel = item.spec.heavy ? targetVx * 0.25 + 0.04 : targetVx * 0.32 + 0.14;
            const nextVx = Math.min(targetVx, b.velocity.x + accel);
            Matter.Body.setVelocity(b, { x: nextVx, y: b.velocity.y });
          }
          addedNoise += item.spec.pushNoisePerSec * noiseFactor * dtSec;
        }
      }
    }

    // 来电震动手机自滑机制
    for (const item of this.items) {
      if (item.dropped || !item.spec.selfBuzz) continue;
      if (item.body.position.y > this.t.scene.tableTopY + 12) continue;
      const buzz = stepPhoneBuzz(item.buzzCycleSec, dtSec);
      item.buzzCycleSec = buzz.nextCycleSec;
      item.isBuzzing = buzz.isBuzzing;
      if (buzz.shouldSlideImpulse) {
        phoneBuzzed = true;
        Matter.Body.setVelocity(item.body, {
          x: Math.max(item.body.velocity.x, 0.72),
          y: item.body.velocity.y - 0.08,
        });
      }
    }

    this.cat.pushingHeavy = pushingHeavy;
    const targetPaw = pushingAny || canTap ? 1 : moveDir !== 0 ? 0.35 : 0;
    this.cat.pawExtend += (targetPaw - this.cat.pawExtend) * Math.min(1, dtSec * 18);

    // 双猫争宠模式：傲娇白猫 AI 决策、轻拍往左侧弹开换位、贪心破绽与防重叠挤撞
    if (this.versusMode) {
      const rivalSpeedMult = this.t.versus.rivalSpeedByDifficulty[difficulty];
      this.rival.stunSec = Math.max(0, this.rival.stunSec - dtSec);
      this.rival.tapStunSec = Math.max(0, this.rival.tapStunSec - dtSec);
      this.rival.shoveArcSec = Math.max(0, this.rival.shoveArcSec - dtSec);
      this.rival.angrySec = Math.max(0, this.rival.angrySec - dtSec);
      this.rival.tapCooldownSec = Math.max(0, this.rival.tapCooldownSec - dtSec);

      // 「轻拍!」贴近白猫时把白猫往玩家身后（左侧）弹退约 65px 换位并拍晕 ~1.0s
      if (
        canTap &&
        this.rival.stunSec <= 0 &&
        this.rival.tapStunSec <= 0 &&
        Math.abs(this.cat.x - this.rival.x) <= this.t.versus.shoveRangePx
      ) {
        const minGap = this.t.cat.bodyHalfW * 2.1;
        if (this.rival.x >= this.cat.x) {
          const targetRivalX = clamp(this.cat.x - 65, this.t.cat.minX, this.t.cat.maxX);
          this.rival.x = targetRivalX;
          if (this.cat.x - this.rival.x < minGap) {
            this.cat.x = clamp(this.rival.x + minGap, this.t.cat.minX, this.t.cat.maxX);
          }
        } else {
          this.rival.x = clamp(this.rival.x - 50, this.t.cat.minX, this.t.cat.maxX);
        }
        this.rival.tapStunSec = 1.0;
        this.rival.shoveArcSec = 0.28;
        this.rival.angrySec = Math.max(this.rival.angrySec, 1.4);
        this.rival.tapCooldownSec = Math.max(this.rival.tapCooldownSec, 1.0);
        shovedRival = true;
      }

      if (this.rival.prevStewardPhase !== 'WARNING' && stewardPhase === 'WARNING') {
        const pushingTeeterOrAngry =
          this.rival.angrySec > 0 ||
          this.items.some(
            (it) =>
              !it.dropped &&
              it.multiplier >= 2 &&
              (it.lastTouchedBy === 'rival' || Math.abs(it.body.position.x - this.rival.x) <= 68),
          );
        this.rival.reactionTimerSec = computeRivalWarningReactionSec(
          this.t.versus.rivalReactionMinSec,
          this.t.versus.rivalReactionMaxSec,
          this.t.versus.greedyReactionBonusSec,
          pushingTeeterOrAngry,
        );
      } else if (stewardPhase === 'WARNING') {
        this.rival.reactionTimerSec = Math.max(0, this.rival.reactionTimerSec - dtSec);
      } else {
        this.rival.reactionTimerSec = 0;
      }
      this.rival.prevStewardPhase = stewardPhase;

      const candidates = this.items
        .filter((it) => !it.dropped && it.body.position.y <= this.t.scene.tableTopY + 12)
        .map((it) => ({
          id: it.id,
          x: it.body.position.x,
          width: it.spec.width,
          baseScore: it.spec.baseScore,
          dropped: it.dropped,
        }));

      const totalStun = Math.max(this.rival.stunSec, this.rival.tapStunSec);
      const rivalDec = decideRivalAction({
        rivalX: this.rival.x,
        rivalStunSec: totalStun,
        stewardPhase,
        reactionTimerSec: this.rival.reactionTimerSec,
        tapCooldownSec: this.rival.tapCooldownSec,
        tableEdgeX: this.t.scene.tableEdgeX,
        pawReach: this.t.cat.pawReach,
        items: candidates,
      });

      const rivalActiveNow =
        !rivalDec.napping && !rivalDec.stunned && (rivalDec.moveDir !== 0 || rivalDec.tap);
      this.rival.isActive = rivalActiveNow;
      const targetRivalAlert = rivalActiveNow || totalStun > 0 ? 1 : 0;
      this.rival.alertness += (targetRivalAlert - this.rival.alertness) * Math.min(1, dtSec * 8);

      if (rivalDec.moveDir !== 0) {
        const nextRivalX = clamp(
          this.rival.x + rivalDec.moveDir * this.t.cat.moveSpeed * rivalSpeedMult * dtSec,
          this.t.cat.minX,
          this.t.cat.maxX,
        );
        let blocked = false;
        for (const item of this.items) {
          if (item.dropped || item.body.position.y > this.t.scene.tableTopY + 12) continue;
          const leftEdge = item.body.position.x - item.spec.width * 0.5;
          if (
            shouldBlockCatHorizontally(
              this.rival.x,
              nextRivalX,
              rivalDec.moveDir,
              false,
              leftEdge,
              item.body.position.x,
              this.t.cat.bodyHalfW,
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.rival.x = nextRivalX;
        }
      }

      // 两只猫在地面时强制防叠罗汉排斥（仅玩家跳跃滞空时允许从白猫头顶越过）
      if (!jumpRes.isAirborne) {
        const sep = resolveCatGroundSeparation(
          this.cat.x,
          this.rival.x,
          this.t.cat.bodyHalfW * 2.1,
          this.t.cat.minX,
          this.t.cat.maxX,
          moveDir,
        );
        this.cat.x = sep.catX;
        this.rival.x = sep.rivalX;
        if (sep.jostled && moveDir !== 0 && totalStun <= 0) {
          this.rival.angrySec = Math.max(this.rival.angrySec, 0.9);
        }
      }

      if (rivalDec.tap) {
        this.rival.tapCooldownSec = this.t.cat.tapCooldownSec * 1.35;
      }

      let rivalPushingAny = false;
      if (totalStun <= 0 && (rivalDec.moveDir > 0 || rivalDec.tap)) {
        const rivalPawX = this.rival.x + this.t.cat.pawReach;
        for (const item of this.items) {
          if (item.dropped) continue;
          const b = item.body;
          if (
            isItemOwnershipLocked(
              b.position.x,
              b.position.y,
              this.t.scene.tableEdgeX,
              this.t.scene.tableTopY,
            )
          ) {
            continue;
          }
          const halfW = item.spec.width * 0.5;
          const inZone =
            rivalPawX >= b.position.x - halfW - 14 &&
            this.rival.x <= b.position.x + halfW - 2 &&
            b.position.x >= this.rival.x - 4;
          if (!inZone) continue;

          rivalPushingAny = true;
          item.lastTouchedBy = 'rival';
          item.lastTouchedAgeSec = 0;
          const heavyFactor = item.spec.heavy ? this.t.versus.rivalHeavySpeedMult : 1;

          if (rivalDec.tap) {
            item.tapCoastSec = 0.24;
            const tapSpeed = item.spec.heavy
              ? clamp((item.spec.maxNudgeSpeed * 1.85 + 0.45) * rivalSpeedMult * heavyFactor, 0.7, 2.2)
              : clamp(
                  (item.spec.maxNudgeSpeed * 1.25 +
                    (this.t.cat.tapImpulseSpeedBoost * 0.001) / Math.max(item.spec.density, 0.0005)) *
                    rivalSpeedMult,
                  1.1,
                  4.8,
                );
            Matter.Body.setVelocity(b, {
              x: Math.max(b.velocity.x, tapSpeed),
              y: b.velocity.y - (item.spec.heavy ? 0.14 : 0.28),
            });
          } else if (rivalDec.moveDir > 0) {
            const targetVx = item.spec.maxNudgeSpeed * rivalSpeedMult * heavyFactor;
            if (b.velocity.x < targetVx) {
              const accel = item.spec.heavy ? targetVx * 0.22 + 0.03 : targetVx * 0.3 + 0.12;
              Matter.Body.setVelocity(b, { x: Math.min(targetVx, b.velocity.x + accel), y: b.velocity.y });
            }
          }
        }
      }
      const targetRivalPaw = rivalPushingAny || rivalDec.tap ? 1 : rivalDec.moveDir !== 0 ? 0.35 : 0;
      this.rival.pawExtend += (targetRivalPaw - this.rival.pawExtend) * Math.min(1, dtSec * 18);
    }

    // 推进 Matter.js 固定步长
    Matter.Engine.update(this.engine, dtMs);

    const droppedItems: DroppedNotice[] = [];
    const movingOwnerSet = new Set<CatActor>();
    const droppedOwnerSet = new Set<CatActor>();
    let hasMovingItem = false;
    let hasTeeteringItem = false;
    let teeteringItemLabel: string | null = null;
    const snapshots: DisplacedItemSnapshot[] = [];

    for (const item of this.items) {
      item.restoreGraceSec = Math.max(0, item.restoreGraceSec - dtSec);
      item.tapCoastSec = Math.max(0, item.tapCoastSec - dtSec);
      if (item.lastTouchedBy !== null) {
        item.lastTouchedAgeSec += dtSec;
      }
      const b = item.body;

      // 除自滚/震动背刺物品 (pen / lipstick / phone) 外，普通物品在玩家松手后迅速刹车防余滑冤死
      const isSelfMovingKind =
        item.kind === 'pen' || item.kind === 'lipstick' || item.kind === 'phone';
      if (
        !item.dropped &&
        !isSelfMovingKind &&
        moveDir === 0 &&
        !canTap &&
        item.tapCoastSec <= 0 &&
        item.multiplier === 1 &&
        b.position.y <= this.t.scene.tableTopY + 12
      ) {
        const nextVx = b.velocity.x * 0.55;
        const nextAngVel = b.angularVelocity * 0.55;
        if (Math.hypot(nextVx, b.velocity.y) < 0.45 && Math.abs(nextAngVel) < 0.05) {
          Matter.Body.setVelocity(b, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(b, 0);
        } else {
          Matter.Body.setVelocity(b, { x: nextVx, y: b.velocity.y });
          Matter.Body.setAngularVelocity(b, nextAngVel);
        }
      }

      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (
        !item.dropped &&
        item.restoreGraceSec <= 0 &&
        (speed > this.t.steward.motionSpeedThreshold || Math.abs(b.angularVelocity) > 0.04)
      ) {
        hasMovingItem = true;
        movingOwnerSet.add(
          resolveDropOwner(item.lastTouchedBy, item.lastTouchedAgeSec, this.t.versus.touchExpirySec),
        );
      }

      if (!item.dropped) {
        const teeter = evaluateTeeterState(
          b.position.x,
          b.angle,
          this.t.scene.tableEdgeX,
          item.teeterHoldSec,
          dtSec,
          false,
          this.t,
        );
        item.teeterHoldSec = teeter.holdSec;
        item.teeterTier = teeter.tier;
        item.multiplier = teeter.multiplier;
        if (item.multiplier >= 2) {
          hasTeeteringItem = true;
          if (!teeteringItemLabel) teeteringItemLabel = item.spec.label;
        }
        if (b.position.y <= this.t.scene.tableTopY + 12) {
          snapshots.push({
            id: item.id,
            label: item.spec.label,
            x: b.position.x,
            originX: item.originX,
            multiplier: item.multiplier,
          });
        }

        // 高重心易碎物在桌面上提前倾倒碎裂（只拿一半折损分）
        if (
          isFragileBrokenOnTable(
            item.kind,
            b.position.x,
            b.angle,
            this.t.scene.tableEdgeX,
            this.t,
          )
        ) {
          item.dropped = true;
          item.settledAfterDrop = true;
          addedNoise += item.spec.dropNoise * 0.7;
          const score = calculateDropScore(item.kind, 1, true, this.t);
          const owner = resolveDropOwner(
            item.lastTouchedBy,
            item.lastTouchedAgeSec,
            this.t.versus.touchExpirySec,
          );
          droppedOwnerSet.add(owner);
          droppedItems.push({
            kind: item.kind,
            x: b.position.x,
            y: this.t.scene.tableTopY - 8,
            multiplier: 1,
            score,
            heavy: false,
            brokeOnTable: true,
            owner,
          });
          Matter.Composite.remove(this.engine.world, b);
          continue;
        }

        // 触发地板 sensor（或完全跌落到地板线下方）
        if (b.position.y + item.spec.height * 0.4 >= this.t.scene.floorY) {
          item.dropped = true;
          item.settledAfterDrop = true;
          addedNoise += item.spec.dropNoise;
          const score = calculateDropScore(
            item.kind,
            item.multiplier,
            false,
            this.t,
            ownerScoreMult(item, teeterScoreMult),
          );
          const owner = resolveDropOwner(
            item.lastTouchedBy,
            item.lastTouchedAgeSec,
            this.t.versus.touchExpirySec,
          );
          droppedOwnerSet.add(owner);
          droppedItems.push({
            kind: item.kind,
            x: b.position.x,
            y: this.t.scene.floorY - 8,
            multiplier: item.multiplier,
            score,
            heavy: Boolean(item.spec.heavy),
            brokeOnTable: false,
            owner,
          });
          Matter.Composite.remove(this.engine.world, b);
        }
      }
    }

    const waveCleared = this.items.length > 0 && this.items.every((it) => it.dropped);
    const filteredSnapshots = excludeRestoreIds
      ? snapshots.filter((s) => !excludeRestoreIds.has(s.id))
      : snapshots;
    const restoreCandidate = pickRestoreTarget(filteredSnapshots, this.t, difficulty);

    return {
      droppedItems,
      addedNoise,
      hasMovingItem,
      movingOwners: [...movingOwnerSet],
      droppedOwners: [...droppedOwnerSet],
      hasTeeteringItem,
      teeteringItemLabel,
      restoreCandidate,
      waveCleared,
      phoneBuzzed,
      rivalActive: this.versusMode && this.rival.isActive,
      interceptedRival,
      shovedRival,
    };
  }
}

function ownerScoreMult(item: TableItem, playerTeeterMult: number): number {
  return item.lastTouchedBy === 'rival' ? 1 : playerTeeterMult;
}
