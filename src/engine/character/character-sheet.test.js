import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDerivedSheet } from './character-sheet.js';

describe('computeDerivedSheet', () => {
  test('computes ability modifiers, proficiency bonus, HP, and AC for a plain level-5 character', () => {
    const sheet = computeDerivedSheet({
      abilityScores: { str: 14, dex: 16, con: 12, int: 10, wis: 13, cha: 8 },
      level: 5, hitDieSize: 10,
    });
    assert.deepEqual(sheet.abilityModifiers, { str: 2, dex: 3, con: 1, int: 0, wis: 1, cha: -1 });
    assert.equal(sheet.proficiencyBonus, 3);
    // computeMaxHp(5, 10, 1): 11 + 7*4 = 39 (verified independently in hp.test.js)
    assert.equal(sheet.maxHp, 39);
    assert.equal(sheet.ac, 13); // 10 + dex mod (3)
  });

  test('skill proficiency adds proficiency bonus once, expertise adds it twice', () => {
    const sheet = computeDerivedSheet({
      abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      level: 5, hitDieSize: 8,
      skillProficiencies: ['Stealth', 'Acrobatics'],
      skillExpertise: ['Stealth'],
    });
    const dexMod = 3, prof = 3;
    assert.equal(sheet.skillBonuses['Stealth'], dexMod + prof * 2);
    assert.equal(sheet.skillBonuses['Acrobatics'], dexMod + prof);
    assert.equal(sheet.skillBonuses['Athletics'], 0); // str mod 0, not proficient
  });

  test('save proficiency adds proficiency bonus to that ability\'s save', () => {
    const sheet = computeDerivedSheet({
      abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      level: 1, hitDieSize: 8,
      saveProficiencies: ['con'],
    });
    assert.equal(sheet.saveBonuses.con, 2 + 2); // conMod(2) + profBonus(2)
    assert.equal(sheet.saveBonuses.str, 0); // not proficient
  });

  test('a trait statMod adds to AC, max HP, a named skill, and a named save', () => {
    const sheet = computeDerivedSheet({
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      level: 1, hitDieSize: 8,
      traits: [{
        id: 'lucky-charm', name: 'Lucky Charm',
        statMods: [
          { stat: 'ac', value: 1 },
          { stat: 'hp_max', value: 3 },
          { stat: 'Perception', value: 2 },
          { stat: 'save_wis', value: 1 },
        ],
      }],
    });
    assert.equal(sheet.ac, 11); // 10 + 0 (dex mod) + 1 (trait)
    assert.equal(sheet.maxHp, 8 + 0 + 3); // computeMaxHp(1,8,0)=8, plus trait's +3
    assert.equal(sheet.skillBonuses['Perception'], 0 + 2); // wis mod 0 + trait +2
    assert.equal(sheet.saveBonuses.wis, 0 + 1); // wis mod 0 + trait +1
  });

  test('a trait with no statMods (pure flavor) changes nothing', () => {
    const withTrait = computeDerivedSheet({
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      level: 1, hitDieSize: 8,
      traits: [{ id: 'backstory-note', name: 'Grew up on a farm', description: 'Flavor only.' }],
    });
    const withoutTrait = computeDerivedSheet({
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      level: 1, hitDieSize: 8,
    });
    assert.deepEqual(withTrait, withoutTrait);
  });

  test('defaults missing ability scores to 10 (modifier 0) rather than throwing', () => {
    const sheet = computeDerivedSheet({ level: 1, hitDieSize: 8 });
    assert.deepEqual(sheet.abilityModifiers, { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  });
});
