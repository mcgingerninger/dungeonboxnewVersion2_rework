import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allItems, resolveItem } from './catalog.js';

describe('catalog', () => {
  test('every item id is unique across the whole catalog, not just within its own file', () => {
    const ids = allItems.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  test('resolveItem finds an item by id regardless of itemType', () => {
    assert.equal(resolveItem('dagger').itemType, 'weapon');
    assert.equal(resolveItem('leather-armor').itemType, 'armor');
    assert.equal(resolveItem('potion-of-healing')?.itemType, 'consumable');
  });
  test('resolveItem returns null for an unknown id', () => {
    assert.equal(resolveItem('not-a-real-item'), null);
  });
});
