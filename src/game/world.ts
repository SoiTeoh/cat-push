import Matter from 'matter-js';
import { tuning, type ItemKind, type ItemSpec, type Tuning } from '../config/tuning';
import {
  clamp,
  evaluateTeeterState,
  type TeeterTier,
} from './rules';

export interface TableItem {
  readonly id: number;
  readonly kind: ItemKind;
  readonly spec: ItemSpec;
  readonly body: Matter.Body;
  teeterHoldSec: number;
  teeterTier: TeeterTier;
  multiplier: 1 | 2 | 3;
  dropped: boolean;
  settledAfterDrop: boolean;
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
}

export interface DroppedNotice {
  readonly kind: ItemKind;
  readonly x: number;
  readonly y: number;
  readonly multiplier: 1 | 2 | 3;
  readonly score: number;
  readonly heavy: boolean;
}

export interface WorldStepResult {
  readonly droppedItems: readonly DroppedNotice[];
  readonly addedNoise: number;
  readonly hasMovingItem: boolean;
  readonly waveCleared: boolean;
}

const DEFAULT_WAVE_LAYOUT: ReadonlyArray<{ kind: ItemKind; x: number }> = [
  { kind: 'kettle', x: 132 },
  { kind: 'mug', x: 204 },
  { kind: 'pen', x: 244 },
  { kind: 'tissue', x: 270 },
];

export class CatPushWorld {
  public readonly engine: Matter.Engine;
  public readonly tableBody: Matter.Body;
  public readonly floorSensor: Matter.Body;
  public readonly items: TableItem[] = [];
  public readonly cat: CatState;
  public waveCount = 1;

  private nextItemId = 1;

  constructor(private readonly t: Tuning = tuning) {
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
      x: this.t.cat.startX,
      facing: 1,
      alertness: 0,
      idleSec: this.t.cat.napTransitionSec,
      pawExtend: 0,
      isActive: false,
      pushingHeavy: false,
      tapCooldownSec: 0,
    };

    this.spawnWave(1);
  }

  public spawnWave(waveNumber: number): void {
    // 清理上一波残留刚体
    for (const item of this.items) {
      Matter.Composite.remove(this.engine.world, item.body);
    }
    this.items.length = 0;
    this.waveCount = waveNumber;

    // 随波次微调摆放，保持第一波 4 种物品齐全
    const jitter = ((waveNumber - 1) % 3) * 8;
    for (const slot of DEFAULT_WAVE_LAYOUT) {
      this.spawnItem(slot.kind, clamp(slot.x - jitter, 96, this.t.scene.tableEdgeX - 24));
    }
  }

  public spawnItem(kind: ItemKind, x: number): TableItem {
    const spec = this.t.items[kind];
    const spawnY = this.t.scene.tableTopY - spec.height / 2 - 1;

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
    if (kind === 'pen') {
      body = Matter.Bodies.circle(x, spawnY, spec.width / 2, common);
    } else if (kind === 'tissue') {
      body = Matter.Bodies.polygon(x, spawnY, 6, spec.width * 0.45, {
        ...common,
        chamfer: { radius: 3 },
      });
    } else {
      body = Matter.Bodies.rectangle(x, spawnY, spec.width, spec.height, {
        ...common,
        chamfer: { radius: kind === 'kettle' ? 5 : 3 },
      });
    }

    Matter.Composite.add(this.engine.world, body);
    const item: TableItem = {
      id: this.nextItemId++,
      kind,
      spec,
      body,
      teeterHoldSec: 0,
      teeterTier: 'safe',
      multiplier: 1,
      dropped: false,
      settledAfterDrop: false,
    };
    this.items.push(item);
    return item;
  }

  /**
   * 推进一步固定物理步长：
   * moveDir: -1(左) | 0(停/装睡) | 1(右推)
   * tapTriggered: 是否触发一次高风险“快速轻拍”
   */
  public step(moveDir: -1 | 0 | 1, tapTriggered: boolean, dtMs: number): WorldStepResult {
    const dtSec = dtMs / 1000;
    let addedNoise = 0;
    let pushingAny = false;
    let pushingHeavy = false;

    this.cat.tapCooldownSec = Math.max(0, this.cat.tapCooldownSec - dtSec);

    const canTap = tapTriggered && this.cat.tapCooldownSec <= 0;
    if (canTap) {
      this.cat.tapCooldownSec = this.t.cat.tapCooldownSec;
      addedNoise += this.t.cat.tapNoiseSpike;
    }

    const activeInput = moveDir !== 0 || canTap;
    this.cat.isActive = activeInput;

    if (activeInput) {
      this.cat.idleSec = 0;
      this.cat.alertness = clamp(this.cat.alertness + dtSec / 0.08, 0, 1);
      if (moveDir !== 0) {
        this.cat.facing = moveDir;
        this.cat.x = clamp(
          this.cat.x + moveDir * this.t.cat.moveSpeed * dtSec,
          this.t.cat.minX,
          this.t.cat.maxX,
        );
      }
    } else {
      this.cat.idleSec += dtSec;
      this.cat.alertness = clamp(
        1 - this.cat.idleSec / this.t.cat.napTransitionSec,
        0,
        1,
      );
    }

    // 接触物品推力逻辑（仅在猫向右主动推或轻拍时施力，避免装睡误碰）
    const pawX = this.cat.x + this.cat.facing * this.t.cat.pawReach;
    if (moveDir > 0 || canTap) {
      for (const item of this.items) {
        if (item.dropped) continue;
        const b = item.body;
        if (b.position.y > this.t.scene.tableTopY + 12) continue;

        const halfW = item.spec.width * 0.5;
        const leftEdge = b.position.x - halfW;
        const rightEdge = b.position.x + halfW;

        // 猫爪位于物体左侧附近（或轻拍范围内）
        const inPushZone =
          pawX >= leftEdge - 14 &&
          this.cat.x <= rightEdge - 4 &&
          b.position.x >= this.cat.x - 6;

        if (!inPushZone) continue;

        pushingAny = true;
        if (item.kind === 'mug' || item.kind === 'kettle') {
          pushingHeavy = true;
        }

        if (canTap) {
          // 轻拍：对所有物体给一次明显横向速度冲量，重物也能动一下
          const tapSpeed =
            item.spec.maxNudgeSpeed * 1.45 +
            (this.t.cat.tapImpulseSpeedBoost * 0.001) / Math.max(item.spec.density, 0.0005);
          Matter.Body.setVelocity(b, {
            x: Math.max(b.velocity.x, clamp(tapSpeed, 1.4, 5.2)),
            y: b.velocity.y - 0.35,
          });
        } else if (moveDir > 0) {
          // 平滑速度引导：根据物体质量限定最大推速，防止飞出屏幕
          const targetVx = item.spec.maxNudgeSpeed;
          if (b.velocity.x < targetVx) {
            const nextVx = Math.min(targetVx, b.velocity.x + (targetVx * 0.32 + 0.14));
            Matter.Body.setVelocity(b, { x: nextVx, y: b.velocity.y });
          }
          addedNoise += item.spec.pushNoisePerSec * dtSec;
        }
      }
    }

    this.cat.pushingHeavy = pushingHeavy;
    const targetPaw = pushingAny || canTap ? 1 : moveDir !== 0 ? 0.35 : 0;
    this.cat.pawExtend += (targetPaw - this.cat.pawExtend) * Math.min(1, dtSec * 18);

    // 推进 Matter.js 固定步长
    Matter.Engine.update(this.engine, dtMs);

    const droppedItems: DroppedNotice[] = [];
    let hasMovingItem = false;

    for (const item of this.items) {
      const b = item.body;
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (
        !item.dropped &&
        (speed > this.t.steward.motionSpeedThreshold || Math.abs(b.angularVelocity) > 0.04)
      ) {
        hasMovingItem = true;
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

        // 触发地板 sensor（或完全跌落到地板线下方）
        if (b.position.y + item.spec.height * 0.4 >= this.t.scene.floorY) {
          item.dropped = true;
          item.settledAfterDrop = true;
          addedNoise += item.spec.dropNoise;
          const score = Math.round(item.spec.baseScore * item.multiplier);
          droppedItems.push({
            kind: item.kind,
            x: b.position.x,
            y: this.t.scene.floorY - 8,
            multiplier: item.multiplier,
            score,
            heavy: item.kind === 'mug' || item.kind === 'kettle',
          });
          Matter.Composite.remove(this.engine.world, b);
        }
      }
    }

    const waveCleared = this.items.length > 0 && this.items.every((it) => it.dropped);

    return {
      droppedItems,
      addedNoise,
      hasMovingItem,
      waveCleared,
    };
  }
}
