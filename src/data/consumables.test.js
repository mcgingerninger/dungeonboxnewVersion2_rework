import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { consumables } from './consumables.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';

describe('every base consumable validates cleanly against the real schema', () => {
  for (const item of consumables) {
    test(`${item.name} is a valid consumable item`, () => {
      const result = validateItem(item);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  }

  test('every id is unique', () => {
    const ids = consumables.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('covers potion, food, scroll, thrown, and topical categories', () => {
    const categories = new Set(consumables.map(c => c.consumable.consumableCategory));
    assert.ok(categories.has('potion'));
    assert.ok(categories.has('food'));
    assert.ok(categories.has('scroll'));
    assert.ok(categories.has('thrown'));
    assert.ok(categories.has('topical'));
  });

  test('a "damage" kind effect always carries damageDice and damageType', () => {
    for (const item of consumables) {
      for (const effect of item.consumable.effects) {
        if (effect.kind === 'damage') {
          assert.ok(effect.damageDice, `${item.name} damage effect missing damageDice`);
          assert.ok(effect.damageType, `${item.name} damage effect missing damageType`);
        }
      }
    }
  });

  test('a "heal" kind effect always carries healDice', () => {
    for (const item of consumables) {
      for (const effect of item.consumable.effects) {
        if (effect.kind === 'heal') assert.ok(effect.healDice, `${item.name} heal effect missing healDice`);
      }
    }
  });

  test('every item declares consumable.uses.max and starts with usesLeft === uses.max', () => {
    for (const item of consumables) {
      assert.equal(typeof item.consumable.uses?.max, 'number', `${item.name} missing uses.max`);
      assert.equal(item.consumable.usesLeft, item.consumable.uses.max, `${item.name} usesLeft should start at uses.max`);
    }
  });

  test('Corked Vial of Spirits keeps its real 2-use count from the reference data', () => {
    const vial = consumables.find(c => c.id === 'corked-vial-of-spirits');
    assert.equal(vial.consumable.uses.max, 2);
  });
});

describe('validateItem catches malformed consumable effects (regression guard for the new checks)', () => {
  test('a "heal" effect with no healDice is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'consumable', rarity: 'common', consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal' }], uses: { max: 1 }, usesLeft: 1 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('healDice')));
  });
  test('a "damage" effect with no damageDice/damageType is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'consumable', rarity: 'common', consumable: { consumableCategory: 'scroll', effects: [{ kind: 'damage' }], uses: { max: 1 }, usesLeft: 1 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('damageDice')));
  });
  test('an item with no consumable.uses at all is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'consumable', rarity: 'common', consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '1d4' }] } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('uses.max')));
  });
  test('an item with uses.max but no usesLeft is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'consumable', rarity: 'common', consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '1d4' }], uses: { max: 1 } } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('usesLeft')));
  });
});

describe('interactions apply correctly to real consumable data', () => {
  test('potions and food report consume; scrolls report read, not consume', () => {
    const potion = consumables.find(c => c.id === 'potion-of-healing');
    const rations = consumables.find(c => c.id === 'iron-rations');
    const scroll = consumables.find(c => c.id === 'scroll-of-fireball');
    assert.equal(canInteract(potion, 'consume'), true);
    assert.equal(canInteract(rations, 'consume'), true);
    assert.equal(canInteract(scroll, 'consume'), false);
    assert.equal(canInteract(scroll, 'read'), true);
    assert.equal(canInteract(potion, 'read'), false);
  });

  test('the thrown alchemist\'s fire reports throw; potions do not', () => {
    const fire = consumables.find(c => c.id === 'alchemists-fire');
    const potion = consumables.find(c => c.id === 'potion-of-healing');
    assert.equal(canInteract(fire, 'throw'), true);
    assert.equal(canInteract(potion, 'throw'), false);
  });

  test('every consumable that consumes itself on use reports crumble', () => {
    for (const item of consumables) {
      assert.equal(canInteract(item, 'crumble'), true, item.name);
    }
  });

  test('the topical vial of spirits reports apply', () => {
    const spirits = consumables.find(c => c.id === 'corked-vial-of-spirits');
    assert.equal(canInteract(spirits, 'apply'), true);
  });

  test('no consumable ever reports equip, enchant, repair, or salvage', () => {
    for (const item of consumables) {
      for (const action of ['equip', 'enchant', 'repair', 'salvage']) {
        assert.equal(canInteract(item, action), false, `${item.name} / ${action}`);
      }
    }
  });
});
