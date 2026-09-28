import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { monsterPartMaterials } from './monster-part-materials.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';

describe('curated monster-part material batch', () => {
  for (const item of monsterPartMaterials) {
    test(`${item.name} is a valid material item`, () => {
      assert.deepEqual(validateItem(item).errors, []);
    });
  }

  test('every id is unique', () => {
    const ids = monsterPartMaterials.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('covers at least 3 distinct source monsters and 3 distinct rarity tiers', () => {
    assert.ok(new Set(monsterPartMaterials.map(m => m.id.split('-').slice(2, -1).join('-'))).size >= 3);
    assert.ok(new Set(monsterPartMaterials.map(m => m.rarity)).size >= 3);
  });

  test('the Red Dragon wing resolves the real named subtype theme, not just the dragon family', () => {
    const wing = monsterPartMaterials.find(m => m.name.startsWith('Red Dragon'));
    assert.ok(wing, 'expected a Red Dragon part in the batch');
    assert.match(wing.flavorText, /red dragon/i);
  });

  test('every entry reports craft_material, and only reagent-tagged ones report reagent', () => {
    for (const item of monsterPartMaterials) {
      assert.equal(canInteract(item, 'craft_material'), true, item.name);
      assert.equal(canInteract(item, 'reagent'), item.material.materialTags.includes('reagent'), item.name);
    }
  });
});
