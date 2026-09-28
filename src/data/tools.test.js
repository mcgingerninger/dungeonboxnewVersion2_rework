import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tools } from './tools.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';

describe('every base tool validates cleanly against the real schema', () => {
  for (const item of tools) {
    test(`${item.name} is a valid tool item`, () => {
      const result = validateItem(item);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  }

  test('every id is unique', () => {
    const ids = tools.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every tool has a non-empty toolCategory', () => {
    for (const item of tools) assert.ok(item.tool.toolCategory, item.name);
  });

  test('covers 5 distinct tool categories', () => {
    const categories = new Set(tools.map(t => t.tool.toolCategory));
    assert.equal(categories.size, 5);
  });

  test('no tool carries a weapon/armor/consumable/material/abilities/grants facet', () => {
    for (const item of tools) {
      for (const facet of ['weapon', 'armor', 'consumable', 'material', 'abilities', 'grants']) {
        assert.equal(item[facet], undefined, `${item.name} should not have a "${facet}" facet`);
      }
    }
  });
});

describe('interactions apply correctly to real tool data', () => {
  test('no tool ever reports equip, consume, throw, or craft_material', () => {
    for (const item of tools) {
      for (const action of ['equip', 'consume', 'throw', 'craft_material']) {
        assert.equal(canInteract(item, action), false, `${item.name} / ${action}`);
      }
    }
  });
});

describe('a tool could carry a passive bonus per the facet table (not used by this batch, but allowed)', () => {
  test('validateItem accepts a hypothetical masterwork tool with a passive skill bonus', () => {
    const masterworkTool = {
      id: 'masterwork-whetstone', name: 'Masterwork Whetstone', itemType: 'tool', rarity: 'uncommon',
      tool: { toolCategory: 'weaponsmith' },
      passive: [{ stat: 'Sleight of Hand', value: 1 }],
    };
    assert.deepEqual(validateItem(masterworkTool), { valid: true, errors: [] });
  });
  test('but a tool still cannot carry an abilities or grants facet', () => {
    const invalid = { id: 'x', name: 'X', itemType: 'tool', rarity: 'common', tool: { toolCategory: 'cartographer' }, abilities: [] };
    const result = validateItem(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cannot have a "abilities" facet')));
  });
});
