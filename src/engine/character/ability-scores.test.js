import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { abilityModifier, proficiencyBonusForLevel, SKILL_ABILITY_MAP, ABILITY_NAMES } from './ability-scores.js';

describe('abilityModifier', () => {
  test('10 and 11 both floor to +0', () => {
    assert.equal(abilityModifier(10), 0);
    assert.equal(abilityModifier(11), 0);
  });
  test('standard score-to-modifier table spot checks', () => {
    assert.equal(abilityModifier(8), -1);
    assert.equal(abilityModifier(1), -5);
    assert.equal(abilityModifier(20), 5);
    assert.equal(abilityModifier(30), 10);
  });
});

describe('proficiencyBonusForLevel', () => {
  test('matches the standard 5e level breakpoints', () => {
    assert.equal(proficiencyBonusForLevel(1), 2);
    assert.equal(proficiencyBonusForLevel(4), 2);
    assert.equal(proficiencyBonusForLevel(5), 3);
    assert.equal(proficiencyBonusForLevel(8), 3);
    assert.equal(proficiencyBonusForLevel(9), 4);
    assert.equal(proficiencyBonusForLevel(12), 4);
    assert.equal(proficiencyBonusForLevel(13), 5);
    assert.equal(proficiencyBonusForLevel(16), 5);
    assert.equal(proficiencyBonusForLevel(17), 6);
    assert.equal(proficiencyBonusForLevel(20), 6);
  });
});

describe('SKILL_ABILITY_MAP', () => {
  test('has exactly the 18 standard 5e skills', () => {
    assert.equal(Object.keys(SKILL_ABILITY_MAP).length, 18);
  });
  test('every mapped ability abbreviation is a real ability', () => {
    for (const abbr of Object.values(SKILL_ABILITY_MAP)) {
      assert.ok(Object.keys(ABILITY_NAMES).includes(abbr), `unknown ability abbreviation "${abbr}"`);
    }
  });
  test('spot-checks a few skill-to-ability mappings', () => {
    assert.equal(SKILL_ABILITY_MAP['Stealth'], 'dex');
    assert.equal(SKILL_ABILITY_MAP['Athletics'], 'str');
    assert.equal(SKILL_ABILITY_MAP['Arcana'], 'int');
    assert.equal(SKILL_ABILITY_MAP['Persuasion'], 'cha');
  });
});
