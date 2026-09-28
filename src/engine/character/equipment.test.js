import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  equipmentSlotsForItem, canEquipToSlot, equipItem, unequipSlot,
  collectDistinctEquippedItems, collectEquippedTraits, computeEquippedArmorClass,
  computeDerivedSheetWithEquipment,
} from './equipment.js';

const leatherArmor = {
  id: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'common',
  armor: { armorType: 'light', baseAC: 11, addsDexMod: true, slot: 'chest' },
};
const plateArmor = {
  id: 'plate-armor', name: 'Plate Armor', itemType: 'armor', rarity: 'uncommon',
  armor: { armorType: 'heavy', baseAC: 16, addsDexMod: false, slot: 'chest', strengthRequirement: 15, stealthDisadvantage: true },
};
const chainShirt = {
  id: 'chain-shirt', name: 'Chain Shirt', itemType: 'armor', rarity: 'common',
  armor: { armorType: 'medium', baseAC: 13, addsDexMod: true, dexModCap: 2, slot: 'chest' },
};
const woodenShield = {
  id: 'wooden-shield', name: 'Wooden Shield', itemType: 'armor', rarity: 'common',
  armor: { armorType: 'shield', baseAC: 2, addsDexMod: false, slot: 'shield', additive: true },
};
const plateHelm = {
  id: 'plate-helm', name: 'Plate Helm', itemType: 'armor', rarity: 'uncommon',
  armor: { armorType: 'heavy', baseAC: 1, addsDexMod: false, slot: 'helmet', additive: true },
};
const dagger = {
  id: 'dagger', name: 'Dagger', itemType: 'weapon', rarity: 'common',
  weapon: { damageDice: '1d4', damageType: 'piercing', weaponCategory: 'simple', properties: ['finesse', 'light', 'thrown'] },
};
const greatsword = {
  id: 'greatsword', name: 'Greatsword', itemType: 'weapon', rarity: 'common',
  weapon: { damageDice: '2d6', damageType: 'slashing', weaponCategory: 'martial', properties: ['two-handed'] },
};
const ringOfProtection = { // synthetic — no wondrous type yet, but passive facet is schema-legal on weapon/armor
  id: 'plus-one-ring-stand-in', name: '+1 Ring (stand-in)', itemType: 'armor', rarity: 'rare',
  armor: { armorType: 'shield', baseAC: 0, addsDexMod: false, slot: 'shield', additive: true },
  passive: [{ stat: 'ac', value: 1 }, { stat: 'dex', value: 1 }],
};

const CATALOG = { 'leather-armor': leatherArmor, 'plate-armor': plateArmor, 'chain-shirt': chainShirt,
  'wooden-shield': woodenShield, 'plate-helm': plateHelm, dagger, greatsword, 'plus-one-ring-stand-in': ringOfProtection };
const resolveItem = id => CATALOG[id];

describe('equipmentSlotsForItem / canEquipToSlot', () => {
  test('a weapon can target either hand slot', () => {
    assert.deepEqual(equipmentSlotsForItem(dagger), ['weapon1', 'weapon2']);
    assert.equal(canEquipToSlot(dagger, 'weapon1'), true);
    assert.equal(canEquipToSlot(dagger, 'armor'), false);
  });
  test('armor targets exactly the one slot its armor.slot names', () => {
    assert.deepEqual(equipmentSlotsForItem(leatherArmor), ['armor']);
    assert.deepEqual(equipmentSlotsForItem(woodenShield), ['shield']);
    assert.equal(canEquipToSlot(leatherArmor, 'shield'), false);
  });
  test('a consumable/material/tool is never equippable', () => {
    const potion = { itemType: 'consumable' };
    assert.deepEqual(equipmentSlotsForItem(potion), []);
  });
});

describe('equipItem / unequipSlot', () => {
  const inventory = [
    { instanceId: 'i1', itemId: 'leather-armor' },
    { instanceId: 'i2', itemId: 'dagger' },
    { instanceId: 'i3', itemId: 'greatsword' },
  ];

  test('equips into the requested slot', () => {
    const slots = equipItem({}, inventory, 'i1', 'armor', resolveItem);
    assert.equal(slots.armor, 'i1');
  });
  test('rejects equipping to an incompatible slot', () => {
    assert.throws(() => equipItem({}, inventory, 'i1', 'weapon1', resolveItem));
  });
  test('rejects an unknown instanceId', () => {
    assert.throws(() => equipItem({}, inventory, 'nope', 'armor', resolveItem));
  });
  test('does not mutate the input equippedSlots object', () => {
    const before = { armor: null };
    const after = equipItem(before, inventory, 'i1', 'armor', resolveItem);
    assert.equal(before.armor, null);
    assert.equal(after.armor, 'i1');
  });
  test('a two-handed weapon mirrors into both weapon slots', () => {
    const slots = equipItem({}, inventory, 'i3', 'weapon1', resolveItem);
    assert.equal(slots.weapon1, 'i3');
    assert.equal(slots.weapon2, 'i3');
  });
  test('unequipping one half of a two-handed pair clears both', () => {
    const equipped = equipItem({}, inventory, 'i3', 'weapon1', resolveItem);
    const after = unequipSlot(equipped, 'weapon2');
    assert.equal(after.weapon1, null);
    assert.equal(after.weapon2, null);
  });
  test('unequipping a normal one-hand weapon only clears its own slot, not weapon2', () => {
    const after = unequipSlot({ weapon1: 'i2', weapon2: 'i3' }, 'weapon1');
    assert.equal(after.weapon1, null);
    assert.equal(after.weapon2, 'i3');
  });
});

describe('collectDistinctEquippedItems / collectEquippedTraits', () => {
  const inventory = [{ instanceId: 'i1', itemId: 'greatsword' }, { instanceId: 'i2', itemId: 'plus-one-ring-stand-in' }];

  test('a two-handed weapon mirrored across both slots counts once', () => {
    const slots = { weapon1: 'i1', weapon2: 'i1' };
    const items = collectDistinctEquippedItems(slots, inventory, resolveItem);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'greatsword');
  });
  test('only items with a passive facet produce a synthetic trait', () => {
    const slots = { weapon1: 'i1', shield: 'i2' };
    const traits = collectEquippedTraits(slots, inventory, resolveItem);
    assert.equal(traits.length, 1);
    assert.equal(traits[0].name, '+1 Ring (stand-in)');
    assert.deepEqual(traits[0].statMods, [{ stat: 'ac', value: 1 }, { stat: 'dex', value: 1 }]);
  });
});

describe('computeEquippedArmorClass', () => {
  const inventory = [
    { instanceId: 'ia', itemId: 'leather-armor' }, { instanceId: 'ip', itemId: 'plate-armor' },
    { instanceId: 'ic', itemId: 'chain-shirt' }, { instanceId: 'is', itemId: 'wooden-shield' },
    { instanceId: 'ih', itemId: 'plate-helm' },
  ];

  test('no body armor equipped: base 10 + full Dex, same as the unarmored formula', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: {}, inventory, resolveItem, dexModifier: 3 });
    assert.equal(ac.total, 13);
    assert.equal(ac.baseSource, null);
  });
  test('light armor (addsDexMod, no cap): full Dex added on top of its own baseAC', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: { armor: 'ia' }, inventory, resolveItem, dexModifier: 3 });
    assert.equal(ac.total, 14); // 11 + 3
    assert.equal(ac.baseSource, 'Leather Armor');
  });
  test('medium armor with a dexModCap: Dex contribution is capped, not zeroed', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: { armor: 'ic' }, inventory, resolveItem, dexModifier: 5 });
    assert.equal(ac.dexContribution, 2);
    assert.equal(ac.total, 15); // 13 + 2
  });
  test('heavy armor (addsDexMod: false): Dex contributes nothing regardless of modifier', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: { armor: 'ip' }, inventory, resolveItem, dexModifier: 4 });
    assert.equal(ac.dexContribution, 0);
    assert.equal(ac.total, 16);
  });
  test('a shield/helmet (additive) adds its own baseAC on top of body armor', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: { armor: 'ia', shield: 'is', helmet: 'ih' }, inventory, resolveItem, dexModifier: 1 });
    assert.equal(ac.total, 15); // 11 + 1 dex + 2 shield + 1 helmet
    assert.equal(ac.additiveSources.length, 2);
  });
  test('flatAcBonus folds in a trait/passive ac StatModifier on top of everything else', () => {
    const ac = computeEquippedArmorClass({ equippedSlots: { armor: 'ia' }, inventory, resolveItem, dexModifier: 0, flatAcBonus: 2 });
    assert.equal(ac.total, 13); // 11 + 0 + 2
  });
});

describe('computeDerivedSheetWithEquipment', () => {
  const inventory = [
    { instanceId: 'ip', itemId: 'plate-armor' }, { instanceId: 'ir', itemId: 'plus-one-ring-stand-in' },
  ];
  const character = {
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    level: 3, hitDieSize: 10, proficiencyBonus: 2, traits: [],
  };

  test('AC reflects equipped heavy armor + a passive ac bonus, not the unarmored 10+Dex formula', () => {
    const sheet = computeDerivedSheetWithEquipment(character, { armor: 'ip', shield: 'ir' }, inventory, resolveItem);
    // plate baseAC 16, no dex, + ring's own baseAC 0 (additive, contributes nothing) + ring's passive +1 ac
    assert.equal(sheet.ac, 17);
  });
  test("the ring's passive +1 Dexterity also raises the ability modifier generically, for free", () => {
    const withRing = computeDerivedSheetWithEquipment(character, { shield: 'ir' }, inventory, resolveItem);
    const withoutRing = computeDerivedSheetWithEquipment(character, {}, inventory, resolveItem);
    assert.equal(withRing.abilityModifiers.dex, withoutRing.abilityModifiers.dex + 1);
  });
  test('an empty equippedSlots behaves identically to the plain computeDerivedSheet AC formula', () => {
    const sheet = computeDerivedSheetWithEquipment(character, {}, inventory, resolveItem);
    assert.equal(sheet.ac, 10 + sheet.abilityModifiers.dex);
  });
});
