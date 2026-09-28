import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeItemInteractions, canInteract } from './interactions.js';

const LONGSWORD = { itemType: 'weapon', weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: [] } };
const THROWN_DAGGER = { itemType: 'weapon', weapon: { damageDice: '1d4', damageType: 'piercing', weaponCategory: 'simple', properties: ['thrown'] } };
const ARTIFACT_SWORD = { itemType: 'weapon', requiresAttunement: true, weapon: LONGSWORD.weapon };
const LEATHER_ARMOR = { itemType: 'armor', armor: { armorType: 'light', baseAC: 11, addsDexMod: true } };
const HEALING_POTION = { itemType: 'consumable', consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '2d4' }], uses: { max: 1 }, usesLeft: 1 } };
const SCROLL = { itemType: 'consumable', consumable: { consumableCategory: 'scroll', effects: [{ kind: 'damage', damageDice: '8d6', damageType: 'fire' }], uses: { max: 1 }, usesLeft: 1 } };
const RATIONS = { itemType: 'consumable', consumable: { consumableCategory: 'food', effects: [{ kind: 'utility' }], uses: { max: 1 }, usesLeft: 1 } };
const ALCHEMISTS_FIRE = { itemType: 'consumable', consumable: { consumableCategory: 'thrown', effects: [{ kind: 'damage', damageDice: '1d4', damageType: 'fire' }], uses: { max: 1 }, usesLeft: 1 } };
const POISON_COATING = { itemType: 'consumable', consumable: { consumableCategory: 'coating', effects: [{ kind: 'debuff' }], uses: { max: 1 }, usesLeft: 1 } };
const GEM = { itemType: 'consumable', consumable: { consumableCategory: 'other', effects: [{ kind: 'utility' }], uses: { max: 3 }, usesLeft: 3 } };

describe('equip', () => {
  test('applies to weapon and armor, never consumable', () => {
    assert.equal(canInteract(LONGSWORD, 'equip'), true);
    assert.equal(canInteract(LEATHER_ARMOR, 'equip'), true);
    assert.equal(canInteract(HEALING_POTION, 'equip'), false);
  });
});

describe('attune', () => {
  test('only when requiresAttunement is explicitly true — never inferred from text', () => {
    assert.equal(canInteract(ARTIFACT_SWORD, 'attune'), true);
    assert.equal(canInteract(LONGSWORD, 'attune'), false);
  });
});

describe('enchant / repair / salvage', () => {
  test('apply to weapon and armor, never consumable', () => {
    for (const action of ['enchant', 'repair', 'salvage']) {
      assert.equal(canInteract(LONGSWORD, action), true, action);
      assert.equal(canInteract(LEATHER_ARMOR, action), true, action);
      assert.equal(canInteract(HEALING_POTION, action), false, action);
    }
  });
});

describe('consume', () => {
  test('potion and food only — not scroll, thrown, coating, or other', () => {
    assert.equal(canInteract(HEALING_POTION, 'consume'), true);
    assert.equal(canInteract(RATIONS, 'consume'), true);
    assert.equal(canInteract(SCROLL, 'consume'), false);
    assert.equal(canInteract(ALCHEMISTS_FIRE, 'consume'), false);
    assert.equal(canInteract(POISON_COATING, 'consume'), false);
  });
});

describe('apply', () => {
  test('potion, food, and topical — broader than consume, still not scroll/thrown/coating', () => {
    assert.equal(canInteract(HEALING_POTION, 'apply'), true);
    assert.equal(canInteract(RATIONS, 'apply'), true);
    assert.equal(canInteract(SCROLL, 'apply'), false);
  });
});

describe('read', () => {
  test('scrolls only — the gap the old registry was missing entirely', () => {
    assert.equal(canInteract(SCROLL, 'read'), true);
    assert.equal(canInteract(HEALING_POTION, 'read'), false);
  });
});

describe('crumble', () => {
  test('true for any well-formed consumable — every one has a finite uses.max, none recharge', () => {
    assert.equal(canInteract(HEALING_POTION, 'crumble'), true);
    assert.equal(canInteract(GEM, 'crumble'), true); // multi-use (uses.max: 3), still eventually crumbles
  });
  test('false for a malformed item with no consumable.uses at all', () => {
    const malformed = { itemType: 'consumable', consumable: { consumableCategory: 'other', effects: [{ kind: 'utility' }] } };
    assert.equal(canInteract(malformed, 'crumble'), false);
  });
});

describe('throw', () => {
  test('a weapon with the "thrown" property, or a consumable tagged thrown', () => {
    assert.equal(canInteract(THROWN_DAGGER, 'throw'), true);
    assert.equal(canInteract(LONGSWORD, 'throw'), false);
    assert.equal(canInteract(ALCHEMISTS_FIRE, 'throw'), true);
    assert.equal(canInteract(HEALING_POTION, 'throw'), false);
  });
});

describe('weapon_coating', () => {
  test('only the coating consumable category', () => {
    assert.equal(canInteract(POISON_COATING, 'weapon_coating'), true);
    assert.equal(canInteract(HEALING_POTION, 'weapon_coating'), false);
  });
});

describe('computeItemInteractions', () => {
  test('extraInteractions adds tags beyond the default rules', () => {
    const item = { ...GEM, extraInteractions: ['throw'] };
    assert.ok(computeItemInteractions(item).includes('throw'));
  });
  test('blockedInteractions removes a tag the default rules would otherwise grant', () => {
    const item = { ...HEALING_POTION, blockedInteractions: ['consume'] };
    assert.ok(!computeItemInteractions(item).includes('consume'));
    assert.equal(canInteract(item, 'consume'), false);
  });
});

describe('canInteract', () => {
  test('an unknown action or a falsy item returns false, never throws', () => {
    assert.equal(canInteract(LONGSWORD, 'not_a_real_action'), false);
    assert.equal(canInteract(null, 'equip'), false);
  });
});
