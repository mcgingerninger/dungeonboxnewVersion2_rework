import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { armor } from './armor.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';
import { applyModifierToItem } from '../engine/items/modifiers.js';

describe('every base armor item validates cleanly against the real schema', () => {
  for (const item of armor) {
    test(`${item.name} is a valid armor item`, () => {
      const result = validateItem(item);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  }

  test('every id is unique', () => {
    const ids = armor.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('light, medium, heavy, and shield are all represented', () => {
    const types = new Set(armor.map(a => a.armor.armorType));
    assert.deepEqual([...types].sort(), ['heavy', 'light', 'medium', 'shield']);
  });

  test('heavy armor and the shield never add a Dex modifier; light/medium do', () => {
    const chainMail = armor.find(a => a.id === 'chain-mail');
    const shield = armor.find(a => a.id === 'wooden-shield');
    const leather = armor.find(a => a.id === 'leather-armor');
    assert.equal(chainMail.armor.addsDexMod, false);
    assert.equal(shield.armor.addsDexMod, false);
    assert.equal(leather.armor.addsDexMod, true);
  });

  test('medium armor caps its Dex bonus; light armor does not', () => {
    const chainShirt = armor.find(a => a.id === 'chain-shirt');
    const leather = armor.find(a => a.id === 'leather-armor');
    assert.equal(chainShirt.armor.dexModCap, 2);
    assert.equal(leather.armor.dexModCap, undefined);
  });
});

describe('interactions apply correctly to real armor data', () => {
  test('every piece of armor is equippable, enchantable, repairable, and salvageable', () => {
    for (const item of armor) {
      assert.equal(canInteract(item, 'equip'), true, item.name);
      assert.equal(canInteract(item, 'enchant'), true, item.name);
      assert.equal(canInteract(item, 'repair'), true, item.name);
      assert.equal(canInteract(item, 'salvage'), true, item.name);
    }
  });
  test('armor never reports weapon-only or consumable-only interactions', () => {
    for (const item of armor) {
      assert.equal(canInteract(item, 'throw'), false, item.name);
      assert.equal(canInteract(item, 'consume'), false, item.name);
    }
  });
});

describe('a real base armor composes with a real modifier (base + modifier scalable system)', () => {
  test('applying "+1" to Chain Mail adds AC without touching its base armor data', () => {
    const chainMail = armor.find(a => a.id === 'chain-mail');
    const plusOne = {
      id: 'plus-one-ac', name: '+1', appliesTo: ['weapon', 'armor'], rarity: 'uncommon',
      passiveMods: [{ stat: 'ac', value: 1 }], nameTemplate: '{base} +1',
    };
    const modified = applyModifierToItem(chainMail, plusOne);
    assert.equal(modified.name, 'Chain Mail +1');
    assert.deepEqual(modified.passive, [{ stat: 'ac', value: 1 }]);
    assert.equal(modified.armor.baseAC, 16); // the modifier adds a passive AC bump, doesn't rewrite baseAC
    assert.deepEqual(validateItem(modified), { valid: true, errors: [] });
    // Base item itself untouched.
    assert.equal(chainMail.passive, undefined);
  });

  test('a weapon-only modifier does not apply to armor', () => {
    const leather = armor.find(a => a.id === 'leather-armor');
    const ofFlaming = { id: 'of-flaming', name: 'of Flaming', appliesTo: ['weapon'], weaponBonusDamage: { dice: '1d6', type: 'fire' }, nameTemplate: '{base} of Flaming' };
    assert.equal(applyModifierToItem(leather, ofFlaming), null);
  });
});
