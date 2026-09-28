// Computes every DERIVED value on a character sheet from raw, stored fields — the single place
// that turns "level 5, DEX 16, proficient in Stealth" into actual usable numbers. Nothing here
// touches the DOM or persistence; a caller (UI or API layer) is responsible for saving the
// results it cares about (e.g. maxHp/ac) back to the character record.
//
// Deliberately replaces the old app's three disconnected freeform fields (level/maxHp/hit dice)
// and prose-derived AC/skill bonuses with one real computation pipeline — see the rebuild plan's
// audit notes on why that was broken.

import { ABILITY_NAMES, SKILL_ABILITY_MAP, abilityModifier, proficiencyBonusForLevel } from './ability-scores.js';
import { computeMaxHp } from './hp.js';
import { collectStatMods, sumModifier } from './stat-modifiers.js';

/**
 * @param {Object} character
 * @param {Object} character.abilityScores  // {str,dex,con,int,wis,cha}, raw 3-20ish scores
 * @param {number} character.level
 * @param {number} character.hitDieSize     // 6|8|10|12
 * @param {number} [character.proficiencyBonus]  // directly adjustable; falls back to the
 *   standard level-derived value ONLY when genuinely absent (undefined/null), never overridden
 *   when a real value (including 0) is present — an explicit adjustment always wins.
 * @param {number} [character.speed]        // base walking speed in feet; defaults to 30
 * @param {string[]} [character.skillProficiencies]
 * @param {string[]} [character.skillExpertise]
 * @param {string[]} [character.saveProficiencies]  // ability abbreviations, e.g. ['dex','str']
 * @param {Array<{statMods: Array<{stat:string, value:number}>}>} [character.traits]
 * @returns {{abilityModifiers: Object, proficiencyBonus: number, maxHp: number, ac: number, effectiveSpeed: number, skillBonuses: Object, saveBonuses: Object}}
 */
export function computeDerivedSheet(character) {
  const {
    abilityScores = {}, level = 1, hitDieSize = 8, speed = 30,
    skillProficiencies = [], skillExpertise = [], saveProficiencies = [], traits = [],
  } = character;

  const abilityModifiers = {};
  for (const abbr of Object.keys(ABILITY_NAMES)) {
    abilityModifiers[abbr] = abilityModifier(abilityScores[abbr] ?? 10);
  }

  const proficiencyBonus = character.proficiencyBonus ?? proficiencyBonusForLevel(level);
  const traitStatMods = collectStatMods(traits);

  const maxHp = computeMaxHp(level, hitDieSize, abilityModifiers.con) + sumModifier(traitStatMods, 'hp_max');
  const ac = 10 + abilityModifiers.dex + sumModifier(traitStatMods, 'ac');
  const effectiveSpeed = speed + sumModifier(traitStatMods, 'speed');

  const skillBonuses = {};
  for (const [skill, abbr] of Object.entries(SKILL_ABILITY_MAP)) {
    let bonus = abilityModifiers[abbr];
    if (skillExpertise.includes(skill)) bonus += proficiencyBonus * 2;
    else if (skillProficiencies.includes(skill)) bonus += proficiencyBonus;
    bonus += sumModifier(traitStatMods, skill);
    skillBonuses[skill] = bonus;
  }

  const saveBonuses = {};
  for (const abbr of Object.keys(ABILITY_NAMES)) {
    let bonus = abilityModifiers[abbr];
    if (saveProficiencies.includes(abbr)) bonus += proficiencyBonus;
    bonus += sumModifier(traitStatMods, `save_${abbr}`);
    saveBonuses[abbr] = bonus;
  }

  return { abilityModifiers, proficiencyBonus, maxHp, ac, effectiveSpeed, skillBonuses, saveBonuses };
}
