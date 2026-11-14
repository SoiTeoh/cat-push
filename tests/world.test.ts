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

  it('initializes rival cat in versusMode and assigns lastTouchedBy on player push', () => {
    const world = new CatPushWorld(tuning, ['tissue'], true);
    expect(world.versusMode).toBe(true);
    const tissue = world.items[0];
    expect(tissue.lastTouchedBy).toBeNull();

    // Move player cat right next to tissue and tap (rival far away on the left)
    world.rival.x = 46;
    world.cat.x = tissue.body.position.x - tissue.spec.width * 0.5 - 12;
    world.step(1, true, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(tissue.lastTouchedBy).toBe('player');
    expect(tissue.lastTouchedAgeSec).toBeCloseTo(0.016, 3);
  });

  it('detects interceptedRival when player steals a rival-owned teetering item and angers rival', () => {
    const world = new CatPushWorld(tuning, ['mug'], true);
    const mug = world.items[0];
    Matter.Body.setPosition(mug.body, {
      x: tuning.scene.tableEdgeX - 8,
      y: tuning.scene.tableTopY - mug.spec.height / 2 - 0.1,
    });
    Matter.Body.setAngle(mug.body, 0.25);
    mug.multiplier = 2;
    mug.lastTouchedBy = 'rival';
    mug.lastTouchedAgeSec = 0.2;

    world.cat.x = mug.body.position.x - mug.spec.width * 0.5 - 12;
    const res = world.step(1, true, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(res.interceptedRival).toBe(true);
    expect(mug.lastTouchedBy).toBe('player');
    expect(world.rival.angrySec).toBeGreaterThan(0.5);
  });

  it('allows player to jump over rival cat without horizontal blocking and freezes rival when stunned', () => {
    const world = new CatPushWorld(tuning, ['tissue'], true);
    world.rival.x = 120;
    world.rival.stunSec = 2.0;
    const beforeRivalX = world.rival.x;

    world.cat.x = 96;
    world.step(1, false, true, 16, 'normal', undefined, undefined, 'RELAXED');
    for (let i = 0; i < 12; i++) {
      world.step(1, false, false, 16, 'normal', undefined, undefined, 'RELAXED');
    }
    expect(world.rival.x).toBe(beforeRivalX);
    expect(world.cat.x).toBeGreaterThan(120);
  });

  it('bounces rival behind player to the left on tap shove and blocks tap-stunned rival from claiming items', () => {
    const world = new CatPushWorld(tuning, ['tissue'], true);
    const tissue = world.items[0];
    world.cat.x = 140;
    world.rival.x = 160; // rival is in front (right) of player

    const res = world.step(1, true, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(res.shovedRival).toBe(true);
    expect(world.rival.x).toBeLessThan(world.cat.x);
    expect(world.rival.tapStunSec).toBeCloseTo(1.0, 2);

    // While tap-stunned, rival touching/near an item cannot overwrite player ownership
    tissue.lastTouchedBy = 'player';
    tissue.lastTouchedAgeSec = 0.2;
    world.rival.x = tissue.body.position.x - tissue.spec.width * 0.5 - 10;
    world.step(0, false, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(tissue.lastTouchedBy).toBe('player');
  });

  it('locks lastTouchedBy once item crosses tableEdgeX - 4 so falling contact cannot steal score', () => {
    const world = new CatPushWorld(tuning, ['mug'], true);
    const mug = world.items[0];
    mug.lastTouchedBy = 'player';
    mug.lastTouchedAgeSec = 0.2;
    Matter.Body.setPosition(mug.body, {
      x: tuning.scene.tableEdgeX - 2,
      y: tuning.scene.tableTopY - mug.spec.height / 2,
    });
    world.cat.x = 60;
    world.rival.x = mug.body.position.x - mug.spec.width * 0.5 - 10;

    world.step(0, false, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(mug.lastTouchedBy).toBe('player');
  });

  it('steals ownership and triggers interceptedRival even on non-teetering rival-owned items', () => {
    const world = new CatPushWorld(tuning, ['tissue'], true);
    const tissue = world.items[0];
    tissue.lastTouchedBy = 'rival';
    tissue.lastTouchedAgeSec = 0.3;
    world.rival.x = 46;
    world.cat.x = tissue.body.position.x - tissue.spec.width * 0.5 - 12;

    const res = world.step(1, true, false, 16, 'normal', undefined, undefined, 'RELAXED');
    expect(res.interceptedRival).toBe(true);
    expect(tissue.lastTouchedBy).toBe('player');
  });
});
