// Item schema for Phase 4 of the mechanics rebuild — weapon, armor, and consumable ONLY.
// material/tool/wondrous/quest/treasure are deliberately deferred (confirmed with the user) until
// their own subcategories get designed; itemType stays an open enum so adding them later doesn't
// require touching this file's existing shapes.
//
// Every mechanical value here is a real typed field, never prose — the old app's `effect` string
// (regex-scraped at runtime for bonuses) is replaced entirely. `flavorText` still exists for
// display, but nothing in this engine ever parses it.

// ---------- Shared vocab ----------

export const WEAPON_CATEGORIES = ['simple', 'martial'];
export const ARMOR_TYPES = ['light', 'medium', 'heavy', 'shield'];
export const CONSUMABLE_CATEGORIES = ['potion', 'food', 'scroll', 'thrown', 'coating', 'topical', 'other'];
export const ON_USE_KINDS = ['heal', 'buff', 'debuff', 'damage', 'utility'];
export const ABILITY_KINDS = ['spell', 'active_effect'];
export const RECHARGE_KINDS = ['short_rest', 'long_rest', 'dawn', 'charges'];

/**
 * @typedef {Object} StatModifier
 * @property {string} stat   // 'ac'|'hp_max'|'speed'|ability abbr|skill name|`save_<abbr>`|'attackRoll'|'damageRoll'
 * @property {number} value
 * @property {string} [condition]  // structured enum, reserved for future use; unrecognized = no effect yet
 */

/**
 * @typedef {Object} OnUseEffect
 * @property {'heal'|'buff'|'debuff'|'damage'|'utility'} kind
 * @property {string} [healDice]
 * @property {StatModifier[]} [statMods]
 * @property {number} [durationMs]     // structured, not a parsed phrase
 * @property {boolean} consumesItem
 */

/**
 * @typedef {Object} Ability
 * @property {string} id
 * @property {string} name
 * @property {'spell'|'active_effect'} kind
 * @property {OnUseEffect} effect
 * @property {{max: number, recharge: 'short_rest'|'long_rest'|'dawn'|'charges'}} uses
 * @property {number} usesLeft
 */

/**
 * @typedef {Object} ProficiencyGrant
 * @property {string[]} [skills]
 * @property {string[]} [saves]           // ability abbreviations
 * @property {string[]} [weaponCategories]  // subset of WEAPON_CATEGORIES
 * @property {string[]} [armorTypes]        // subset of ARMOR_TYPES
 */

/**
 * @typedef {Object} Grants   // non-numeric effects — granting something outright, not a flat bonus
 * @property {ProficiencyGrant} [proficiencies]
 * @property {Array<{id:string,name:string,description?:string,statMods:StatModifier[]}>} [traits]
 *   // same shape as a character's own traits (Phase 2) — merges into computeDerivedSheet's trait
 *   // list while equipped, reusing that exact math rather than a parallel system.
 */

/**
 * @typedef {Object} WeaponData
 * @property {string} damageDice        // '1d8'
 * @property {string} damageType        // 'slashing'|'piercing'|'bludgeoning'|'fire'|...
 * @property {'simple'|'martial'} weaponCategory
 * @property {string[]} [properties]    // ['light','finesse','thrown','versatile','two-handed','reach']
 * @property {string} [versatileDice]
 * @property {number} [rangeNormal]
 * @property {number} [rangeMax]
 * @property {'weapon1'|'weapon2'|'offhand'} [slot]
 */

/**
 * @typedef {Object} ArmorData
 * @property {'light'|'medium'|'heavy'|'shield'} armorType
 * @property {number} baseAC
 * @property {boolean} addsDexMod
 * @property {number} [dexModCap]
 * @property {'helmet'|'chest'|'handwear'|'boots'|'leggings'|'facewear'|'cloak'|'beltwaist'|'shield'} [slot]
 */

/**
 * @typedef {Object} ConsumableData
 * @property {'potion'|'food'|'scroll'|'thrown'|'coating'|'topical'|'other'} consumableCategory
 * @property {OnUseEffect[]} effects
 */

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {string} name
 * @property {'weapon'|'armor'|'consumable'} itemType   // enum will grow later; only these 3 for now
 * @property {string} rarity        // keeps the existing loot-table rarity categories
 * @property {number} [weight]
 * @property {string} [value]       // gp, matches existing loot-table formatting
 * @property {string} [flavorText]  // display only, NEVER parsed for mechanics
 * @property {boolean} [requiresAttunement]
 *
 * @property {WeaponData} [weapon]        // weapon only, required for weapon
 * @property {ArmorData} [armor]          // armor only, required for armor
 * @property {ConsumableData} [consumable] // consumable only, required for consumable
 * @property {StatModifier[]} [passive]   // weapon/armor only — active purely from being equipped
 * @property {Ability[]} [abilities]      // weapon/armor only — activatable, charge-gated
 * @property {Grants} [grants]            // weapon/armor only — proficiencies/traits granted while equipped
 * @property {string[]} [appliedModifiers] // ids of Modifiers (see modifiers.js) baked into this instance
 */

export function blankItem(itemType) {
  const base = { id: '', name: '', itemType, rarity: 'common' };
  if (itemType === 'weapon') return { ...base, weapon: { damageDice: '1d6', damageType: 'bludgeoning', weaponCategory: 'simple' } };
  if (itemType === 'armor') return { ...base, armor: { armorType: 'light', baseAC: 11, addsDexMod: true } };
  if (itemType === 'consumable') return { ...base, consumable: { consumableCategory: 'potion', effects: [] } };
  return base;
}
