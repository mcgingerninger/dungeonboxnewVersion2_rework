// Ability scores, proficiency bonus, and the standard skill list. Ported as-is from
// game-engine.js's ABILITY_NAMES/SKILL_ABILITY_MAP/abilityModifier/proficiencyBonusForLevel —
// per the rebuild plan's audit, this math was never the problem (the old app's issue was
// regex-scraping bonuses out of free text, not this arithmetic), so it's kept, just relocated.

export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

export const SKILL_ABILITY_MAP = {
  'Athletics': 'str',
  'Acrobatics': 'dex', 'Sleight of Hand': 'dex', 'Stealth': 'dex',
  'Arcana': 'int', 'History': 'int', 'Investigation': 'int', 'Nature': 'int', 'Religion': 'int',
  'Animal Handling': 'wis', 'Insight': 'wis', 'Medicine': 'wis', 'Perception': 'wis', 'Survival': 'wis',
  'Deception': 'cha', 'Intimidation': 'cha', 'Performance': 'cha', 'Persuasion': 'cha',
};

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonusForLevel(level) {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}
