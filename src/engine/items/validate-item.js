// Enforces the facet table confirmed with the user — a weapon can never carry an `armor` facet,
// a consumable can never carry `weapon`/`armor`/`passive`/`abilities`, etc. This is what makes
// "swords don't have AC, potions don't have attack dice" a structural guarantee checked here,
// not just an authoring convention nobody enforces.

const FACET_KEYS = ['weapon', 'armor', 'consumable', 'material', 'tool', 'passive', 'abilities', 'grants'];

// required: facet(s) that MUST be present (any-of when an array-of-arrays… here just single names
// except consumable's onUse-equivalent, which lives at consumable.effects, not a top-level key).
// allowed: every facet key permitted in addition to `required`. Anything else present is an error.
const RULES = {
  weapon: { required: ['weapon'], allowed: ['weapon', 'passive', 'abilities', 'grants'] },
  armor: { required: ['armor'], allowed: ['armor', 'passive', 'abilities', 'grants'] },
  consumable: { required: ['consumable'], allowed: ['consumable'] },
  material: { required: ['material'], allowed: ['material'] },       // pure crafting input — no
  // mechanical facets at all, matching the confirmed facet-table philosophy
  tool: { required: ['tool'], allowed: ['tool', 'passive'] },        // a masterwork tool can
  // grant a small passive skill bonus; never weapon/armor/consumable/abilities/grants
};

function presentFacets(item) {
  return FACET_KEYS.filter(k => item[k] !== undefined);
}

/**
 * @param {import('./item-schema.js').Item} item
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object') return { valid: false, errors: ['item must be an object'] };
  if (!item.name) errors.push('name is required');

  const rules = RULES[item.itemType];
  if (!rules) {
    errors.push(`unknown or unsupported itemType "${item.itemType}" — only weapon/armor/consumable/material/tool are modeled so far`);
    return { valid: false, errors };
  }

  const present = presentFacets(item);
  for (const req of rules.required) {
    if (!present.includes(req)) errors.push(`itemType "${item.itemType}" requires a "${req}" facet`);
  }
  for (const facet of present) {
    if (!rules.allowed.includes(facet)) errors.push(`itemType "${item.itemType}" cannot have a "${facet}" facet`);
  }

  if (item.itemType === 'weapon' && item.weapon) {
    if (!item.weapon.damageDice) errors.push('weapon.damageDice is required');
    if (!item.weapon.damageType) errors.push('weapon.damageType is required');
  }
  if (item.itemType === 'armor' && item.armor) {
    if (typeof item.armor.baseAC !== 'number') errors.push('armor.baseAC must be a number');
  }
  if (item.itemType === 'consumable' && item.consumable) {
    if (!Array.isArray(item.consumable.effects) || !item.consumable.effects.length) {
      errors.push('consumable.effects must be a non-empty array');
    } else {
      item.consumable.effects.forEach((effect, i) => {
        if (effect.kind === 'heal' && !effect.healDice) errors.push(`consumable.effects[${i}] is kind "heal" but has no healDice`);
        if (effect.kind === 'damage' && (!effect.damageDice || !effect.damageType)) errors.push(`consumable.effects[${i}] is kind "damage" but is missing damageDice/damageType`);
      });
    }
    if (!item.consumable.uses || typeof item.consumable.uses.max !== 'number' || item.consumable.uses.max < 1) {
      errors.push('consumable.uses.max must be a number >= 1');
    }
    if (typeof item.consumable.usesLeft !== 'number') errors.push('consumable.usesLeft must be a number');
  }
  if (item.itemType === 'material' && item.material) {
    if (!Array.isArray(item.material.materialTags)) errors.push('material.materialTags must be an array');
  }
  if (item.itemType === 'tool' && item.tool) {
    if (!item.tool.toolCategory) errors.push('tool.toolCategory is required');
  }

  return { valid: errors.length === 0, errors };
}
