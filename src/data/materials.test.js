import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { materials } from './materials.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';

describe('every base material validates cleanly against the real schema', () => {
  for (const item of materials) {
    test(`${item.name} is a valid material item`, () => {
      const result = validateItem(item);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  }

  test('every id is unique', () => {
    const ids = materials.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('no material carries any mechanical facet — pure crafting input', () => {
    for (const item of materials) {
      for (const facet of ['weapon', 'armor', 'consumable', 'tool', 'passive', 'abilities', 'grants']) {
        assert.equal(item[facet], undefined, `${item.name} should not have a "${facet}" facet`);
      }
    }
  });
});

describe('interactions apply correctly to real material data', () => {
  test('every material reports craft_material', () => {
    for (const item of materials) assert.equal(canInteract(item, 'craft_material'), true, item.name);
  });
  test('only materials tagged "reagent" report the reagent interaction', () => {
    const herbs = materials.find(m => m.id === 'dried-herbs');
    const wax = materials.find(m => m.id === 'beeswax-block');
    assert.equal(canInteract(herbs, 'reagent'), true);
    assert.equal(canInteract(wax, 'reagent'), false);
  });
  test('no material ever reports equip, consume, or throw', () => {
    for (const item of materials) {
      for (const action of ['equip', 'consume', 'throw']) {
        assert.equal(canInteract(item, action), false, `${item.name} / ${action}`);
      }
    }
  });
});
