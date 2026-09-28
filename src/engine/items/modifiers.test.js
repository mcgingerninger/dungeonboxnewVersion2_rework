import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyModifierToItem, applyModifiers, formatModifiedName } from './modifiers.js';

const LONGSWORD = {
  id: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'common',
  weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: [] },
};
const LEATHER_ARMOR = {
  id: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'common',
  armor: { armorType: 'light', baseAC: 11, addsDexMod: true },
};

const PLUS_ONE = {
  id: 'plus-one', name: '+1', appliesTo: ['weapon', 'armor'], rarity: 'uncommon',
  passiveMods: [{ stat: 'attackRoll', value: 1 }, { stat: 'damageRoll', value: 1 }],
  nameTemplate: '{base} +1',
};
const OF_FLAMING = {
  id: 'of-flaming', name: 'of Flaming', appliesTo: ['weapon'], rarity: 'rare',
  weaponBonusDamage: { dice: '1d6', type: 'fire' },
  nameTemplate: '{base} of Flaming',
};
const OF_ARMORED_AC = {
  id: 'plus-one-ac', name: '+1 AC', appliesTo: ['armor'], rarity: 'uncommon',
  passiveMods: [{ stat: 'ac', value: 1 }],
  nameTemplate: '{base} +1',
};

describe('formatModifiedName', () => {
  test('substitutes {base} with the original item name', () => {
    assert.equal(formatModifiedName('{base} +1', 'Longsword'), 'Longsword +1');
    assert.equal(formatModifiedName('{base} of Flaming', 'Longsword'), 'Longsword of Flaming');
  });
});

describe('applyModifierToItem', () => {
  test('merges passiveMods onto the item\'s passive array and renames it', () => {
    const result = applyModifierToItem(LONGSWORD, PLUS_ONE);
    assert.equal(result.name, 'Longsword +1');
    assert.deepEqual(result.passive, [{ stat: 'attackRoll', value: 1 }, { stat: 'damageRoll', value: 1 }]);
    assert.deepEqual(result.appliedModifiers, ['plus-one']);
  });

  test('does not mutate the base item (returns a clone)', () => {
    const original = structuredClone(LONGSWORD);
    applyModifierToItem(LONGSWORD, PLUS_ONE);
    assert.deepEqual(LONGSWORD, original);
  });

  test('weaponBonusDamage is appended to weapon.bonusDamage additively', () => {
    const result = applyModifierToItem(LONGSWORD, OF_FLAMING);
    assert.deepEqual(result.weapon.bonusDamage, [{ dice: '1d6', type: 'fire' }]);
    // Original weapon fields untouched.
    assert.equal(result.weapon.damageDice, '1d8');
  });

  test('stacking two modifiers accumulates bonusDamage rather than overwriting it', () => {
    const OF_FROST = { id: 'of-frost', name: 'of Frost', appliesTo: ['weapon'], weaponBonusDamage: { dice: '1d4', type: 'cold' }, nameTemplate: '{base} of Frost' };
    const once = applyModifierToItem(LONGSWORD, OF_FLAMING);
    const twice = applyModifierToItem(once, OF_FROST);
    assert.deepEqual(twice.weapon.bonusDamage, [{ dice: '1d6', type: 'fire' }, { dice: '1d4', type: 'cold' }]);
  });

  test('returns null when the modifier does not apply to this itemType — a weapon-only mod on armor', () => {
    assert.equal(applyModifierToItem(LEATHER_ARMOR, OF_FLAMING), null);
  });

  test('a modifier applicable to both weapon and armor works on either', () => {
    const swordResult = applyModifierToItem(LONGSWORD, PLUS_ONE);
    const armorResult = applyModifierToItem(LEATHER_ARMOR, PLUS_ONE);
    assert.equal(swordResult.name, 'Longsword +1');
    assert.equal(armorResult.name, 'Leather Armor +1');
  });
});

describe('applyModifiers (sequential, generation-time use)', () => {
  test('applies every compatible modifier and stacks their name templates', () => {
    const { item, skipped } = applyModifiers(LONGSWORD, [PLUS_ONE, OF_FLAMING]);
    assert.equal(item.name, 'Longsword +1 of Flaming');
    assert.deepEqual(item.appliedModifiers, ['plus-one', 'of-flaming']);
    assert.deepEqual(skipped, []);
  });

  test('skips an incompatible modifier and reports its id, without throwing', () => {
    const { item, skipped } = applyModifiers(LONGSWORD, [PLUS_ONE, OF_ARMORED_AC]);
    assert.deepEqual(skipped, ['plus-one-ac']);
    // Only the compatible modifier's effect landed.
    assert.deepEqual(item.passive, [{ stat: 'attackRoll', value: 1 }, { stat: 'damageRoll', value: 1 }]);
  });

  test('an empty modifier list returns the base item unchanged', () => {
    const { item, skipped } = applyModifiers(LONGSWORD, []);
    assert.deepEqual(item, LONGSWORD);
    assert.deepEqual(skipped, []);
  });
});
