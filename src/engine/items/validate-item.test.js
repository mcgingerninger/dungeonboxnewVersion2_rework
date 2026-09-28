import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from './validate-item.js';

const LONGSWORD = {
  id: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'common',
  weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: ['versatile'], versatileDice: '1d10' },
};
const LEATHER_ARMOR = {
  id: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'common',
  armor: { armorType: 'light', baseAC: 11, addsDexMod: true },
};
const HEALING_POTION = {
  id: 'healing-potion', name: 'Potion of Healing', itemType: 'consumable', rarity: 'common',
  consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '2d4+2' }], uses: { max: 1 }, usesLeft: 1 },
};

describe('validateItem — the three in-scope types validate cleanly', () => {
  test('a plain weapon is valid', () => {
    assert.deepEqual(validateItem(LONGSWORD), { valid: true, errors: [] });
  });
  test('a plain armor is valid', () => {
    assert.deepEqual(validateItem(LEATHER_ARMOR), { valid: true, errors: [] });
  });
  test('a plain consumable is valid', () => {
    assert.deepEqual(validateItem(HEALING_POTION), { valid: true, errors: [] });
  });
  test('a weapon with passive/abilities/grants is still valid (composite magic weapon)', () => {
    const magicSword = {
      ...LONGSWORD, id: 'flame-tongue', name: 'Flame Tongue',
      passive: [{ stat: 'attackRoll', value: 1 }],
      abilities: [{ id: 'ignite', name: 'Ignite', kind: 'active_effect', effect: { kind: 'damage', damageDice: '2d6', damageType: 'fire' }, uses: { max: 1, recharge: 'dawn' }, usesLeft: 1 }],
      grants: { proficiencies: { skills: ['Intimidation'] } },
    };
    assert.deepEqual(validateItem(magicSword), { valid: true, errors: [] });
  });
});

describe('validateItem — the exact "swords don\'t have AC" rules', () => {
  test('a weapon with an armor facet is rejected', () => {
    const result = validateItem({ ...LONGSWORD, armor: { armorType: 'light', baseAC: 11, addsDexMod: true } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cannot have a "armor" facet')));
  });
  test('armor with a weapon facet is rejected', () => {
    const result = validateItem({ ...LEATHER_ARMOR, weapon: LONGSWORD.weapon });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cannot have a "weapon" facet')));
  });
  test('a consumable with a weapon facet (attack dice on a potion) is rejected', () => {
    const result = validateItem({ ...HEALING_POTION, weapon: LONGSWORD.weapon });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cannot have a "weapon" facet')));
  });
  test('a consumable with a passive facet is rejected — consumables have no "equipped" state', () => {
    const result = validateItem({ ...HEALING_POTION, passive: [{ stat: 'ac', value: 1 }] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cannot have a "passive" facet')));
  });
});

describe('validateItem — required facets and required sub-fields', () => {
  test('a weapon with no weapon facet at all is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'weapon', rarity: 'common' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('requires a "weapon" facet')));
  });
  test('a weapon facet missing damageDice/damageType is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'weapon', rarity: 'common', weapon: { weaponCategory: 'simple' } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('damageDice')));
    assert.ok(result.errors.some(e => e.includes('damageType')));
  });
  test('an armor facet with a non-numeric baseAC is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'armor', rarity: 'common', armor: { armorType: 'light', baseAC: '11', addsDexMod: true } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('baseAC')));
  });
  test('a consumable with an empty effects array is rejected', () => {
    const result = validateItem({ id: 'x', name: 'X', itemType: 'consumable', rarity: 'common', consumable: { consumableCategory: 'potion', effects: [] } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('consumable.effects')));
  });
  test('an item with no name is rejected', () => {
    const result = validateItem({ ...LONGSWORD, name: '' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')));
  });
});

describe('validateItem — deferred item types', () => {
  test('an unsupported itemType (e.g. wondrous, deferred for now) is rejected with a clear reason', () => {
    const result = validateItem({ id: 'x', name: 'Ring of Whatever', itemType: 'wondrous', rarity: 'rare' });
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /unknown or unsupported itemType/);
  });
});
