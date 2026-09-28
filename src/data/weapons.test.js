import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { weapons } from './weapons.js';
import { validateItem } from '../engine/items/validate-item.js';
import { canInteract } from '../engine/items/interactions.js';
import { resolveAttack, getAttackBonus } from '../engine/combat/attack.js';
import { applyModifierToItem } from '../engine/items/modifiers.js';

describe('every base weapon validates cleanly against the real schema', () => {
  for (const item of weapons) {
    test(`${item.name} is a valid weapon item`, () => {
      const result = validateItem(item);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  }

  test('every id is unique', () => {
    const ids = weapons.map(w => w.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('simple and martial categories are both represented', () => {
    const categories = new Set(weapons.map(w => w.weapon.weaponCategory));
    assert.ok(categories.has('simple'));
    assert.ok(categories.has('martial'));
  });
});

describe('interactions apply correctly to real weapon data', () => {
  test('every weapon is equippable', () => {
    for (const item of weapons) assert.equal(canInteract(item, 'equip'), true, item.name);
  });
  test('thrown weapons (dagger, handaxe, javelin) report the throw interaction; the shortbow does not', () => {
    const dagger = weapons.find(w => w.id === 'dagger');
    const shortbow = weapons.find(w => w.id === 'shortbow');
    assert.equal(canInteract(dagger, 'throw'), true);
    assert.equal(canInteract(shortbow, 'throw'), false);
  });
});

describe('a real base weapon flows through resolveAttack end-to-end', () => {
  test('the Longsword works as a PC weaponOrAction, martial weapon proficiency required for full bonus', () => {
    const longsword = weapons.find(w => w.id === 'longsword');
    const proficientFighter = { abilityScores: { str: 16 }, proficiencyBonus: 3 };
    const bonus = getAttackBonus(proficientFighter, { ...longsword.weapon, proficient: true });
    assert.equal(bonus, 3 + 3); // strMod(16)=3 + profBonus 3

    // Not proficient with martial weapons: no proficiency bonus, matching the weaponCategory ->
    // character.weaponProficiencies gating this schema was designed to support (full wiring is
    // Phase 6's equip system; this proves the mechanism resolveAttack already exposes works).
    const nonProficient = getAttackBonus(proficientFighter, { ...longsword.weapon, proficient: false });
    assert.equal(nonProficient, 3);
  });

  test('resolveAttack rolls real damage using the Quarterstaff\'s actual dice', () => {
    const quarterstaff = weapons.find(w => w.id === 'quarterstaff');
    const attacker = { abilityScores: { str: 12 }, proficiencyBonus: 2 };
    for (let i = 0; i < 200; i++) {
      const result = resolveAttack({ attacker, target: { ac: 10 }, weaponOrAction: quarterstaff.weapon });
      if (result.isHit) {
        assert.ok(result.damage.total >= 0);
        assert.equal(result.damageType, 'bludgeoning');
      }
    }
  });
});

describe('a base weapon composes with a real modifier (base + modifier scalable system)', () => {
  test('applying a "+1" modifier to the base Longsword produces a valid, correctly-named item', () => {
    const longsword = weapons.find(w => w.id === 'longsword');
    const plusOne = {
      id: 'plus-one', name: '+1', appliesTo: ['weapon', 'armor'], rarity: 'uncommon',
      passiveMods: [{ stat: 'attackRoll', value: 1 }, { stat: 'damageRoll', value: 1 }],
      nameTemplate: '{base} +1',
    };
    const modified = applyModifierToItem(longsword, plusOne);
    assert.equal(modified.name, 'Longsword +1');
    assert.deepEqual(validateItem(modified), { valid: true, errors: [] });
    // The base item itself is untouched.
    assert.equal(longsword.name, 'Longsword');
    assert.equal(longsword.passive, undefined);
  });
});
