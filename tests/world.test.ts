import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { STAGES, STAGE_IDS } from '../src/config/stages';
import { tuning } from '../src/config/tuning';
import { createStewardState, stepSteward, type StewardState } from '../src/game/rules';
import { CatPushWorld } from '../src/game/world';

describe('CatPushWorld + Steward Integration (Regression Guards)', () => {
  it('spawns all 4 stages with >= 40px edge buffer and keeps hearts=3 & multiplier=1 when idle for 3s', () => {
    const dtMs = tuning.loop.fixedDtMs;
    const dtSec = dtMs / 1000;

    for (const id of STAGE_IDS) {
      const stage = STAGES[id];
      const world = new CatPushWorld(tuning, stage.items);
      let steward: StewardState = createStewardState(tuning);

      for (const item of world.items) {
        const rightEdge = item.originX + item.spec.width * 0.5;
        expect(tuning.scene.tableEdgeX - rightEdge).toBeGreaterThanOrEqual(40);
      }

      // Simulate 3 seconds (180 fixed steps) with zero player input
      for (let i = 0; i < 180; i++) {
        const res = world.step(0, false, false, dtMs);
        steward = stepSteward(
          steward,
          {
            dtSec,
            playerActive: false,
            hasMovingItem: res.hasMovingItem,
            itemDroppedDuringStep: res.droppedItems.length > 0,
            addedNoise: res.addedNoise,
            hasTeeteringItem: res.hasTeeteringItem,
            teeteringItemLabel: res.teeteringItemLabel,
            restoreCandidate: res.restoreCandidate,
            enableTeeterSuspicion: stage.enableTeeterSuspicion,
          },
          tuning,
        );
      }

      expect(steward.hearts).toBe(3);
      expect(steward.phase).not.toBe('CAUGHT');
      for (const item of world.items) {
        expect(item.multiplier).toBe(1);
        expect(item.teeterTier).toBe('safe');
      }
    }
  });

  it('does NOT trigger CAUGHT when steward restores a displaced/teetering item while cat naps', () => {
    const dtMs = tuning.loop.fixedDtMs;
    const dtSec = dtMs / 1000;
    const world = new CatPushWorld(tuning, ['mug']);
    const mug = world.items.find((it) => it.kind === 'mug')!;

    // Displace mug by +50px (beyond normal 42px threshold) and settle it
    Matter.Body.setPosition(mug.body, {
      x: mug.originX + 50,
      y: tuning.scene.tableTopY - mug.spec.height / 2 - 0.1,
    });
    Matter.Body.setVelocity(mug.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(mug.body, 0);

    let steward: StewardState = {
      ...createStewardState(tuning, 'normal'),
      phase: 'WATCHING',
      phaseTimerSec: 1.5,
    };

    for (let i = 0; i < 90; i++) {
      const res = world.step(0, false, false, dtMs, 'normal');
      steward = stepSteward(
        steward,
        {
          dtSec,
          playerActive: false,
          hasMovingItem: res.hasMovingItem,
          itemDroppedDuringStep: res.droppedItems.length > 0,
          addedNoise: res.addedNoise,
          hasTeeteringItem: res.hasTeeteringItem,
          teeteringItemLabel: res.teeteringItemLabel,
          restoreCandidate: res.restoreCandidate,
          enableTeeterSuspicion: false,
        },
        tuning,
      );
      if (steward.lastRestoredId !== null) {
        world.restoreItemById(steward.lastRestoredId, 'normal');
      }
      expect(steward.phase).not.toBe('CAUGHT');
      expect(steward.hearts).toBe(3);
    }

    expect(mug.body.position.x).toBeLessThan(mug.originX + 50);
  });

  it('auto-hops over the kettle ahead when Jump is triggered with moveDir=0', () => {
    const dtMs = tuning.loop.fixedDtMs;
    const world = new CatPushWorld(tuning, STAGES[1].items);
    const kettle = world.items.find((it) => it.kind === 'kettle')!;

    // Place cat right to the left of the kettle
    world.cat.x = kettle.body.position.x - kettle.spec.width / 2 - tuning.cat.bodyHalfW - 4;

    // Trigger jump with moveDir=0 (single-tap / single-click jump)
    world.step(0, false, true, dtMs);
    for (let i = 0; i < 32; i++) {
      world.step(0, false, false, dtMs);
    }

    expect(world.cat.jumpTimerSec).toBe(0);
    expect(world.cat.x).toBeGreaterThan(kettle.body.position.x);
  });

  it('retreats teetering item to >= 42px inside tableEdgeX and zeroes velocities on restoreItemById', () => {
    const world = new CatPushWorld(tuning, ['mug']);
    const mug = world.items.find((it) => it.kind === 'mug')!;

    // Place mug teetering right near the table edge
    Matter.Body.setPosition(mug.body, {
      x: tuning.scene.tableEdgeX - 8,
      y: tuning.scene.tableTopY - mug.spec.height / 2 - 0.1,
    });
    Matter.Body.setAngle(mug.body, 0.28);
    Matter.Body.setVelocity(mug.body, { x: 1.5, y: 0.3 });
    Matter.Body.setAngularVelocity(mug.body, 0.2);
    mug.teeterTier = 'teeter2';
    mug.multiplier = 2;

    const restored = world.restoreItemById(mug.id, 'normal');
    expect(restored).not.toBeNull();
    expect(mug.body.position.x).toBeLessThanOrEqual(tuning.scene.tableEdgeX - 42);
    expect(mug.body.velocity.x).toBe(0);
    expect(mug.body.velocity.y).toBe(0);
    expect(mug.body.angularVelocity).toBe(0);
    expect(mug.body.angle).toBe(0);
    expect(mug.multiplier).toBe(1);
    expect(mug.teeterTier).toBe('safe');
  });
});
