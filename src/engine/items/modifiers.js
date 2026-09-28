// The scalable base-item + modifier system (confirmed with the user: build a small pool of base
// items plus reusable modifiers, rather than hand-authoring every magic variant as a one-off).
// A base item is a plain Item (item-schema.js) with no appliedModifiers. A Modifier is a
// standalone, rarity-tagged bundle of effects that can be layered onto any compatible base item
// at generation time — applyModifierToItem clones the base and merges the modifier in, so the
// same "+1" or "of Flaming" modifier works identically across every weapon it's compatible with,
// instead of being re-authored per item.

/**
 * @typedef {Object} Modifier
 * @property {string} id
 * @property {string} name              // e.g. "+1", "of Flaming"
 * @property {('weapon'|'armor')[]} appliesTo
 * @property {string} rarity            // the rarity tier this modifier is drawn from
 * @property {import('./item-schema.js').StatModifier[]} [passiveMods]
 * @property {import('./item-schema.js').Ability[]} [grantedAbilities]
 * @property {{dice: string, type: string}} [weaponBonusDamage]  // additive extra dice, e.g. +1d6 fire
 * @property {string} nameTemplate      // '{base} +1' / '{base} of Flaming'
 */

export function formatModifiedName(nameTemplate, baseName) {
  return nameTemplate.replace('{base}', baseName);
}

/**
 * @param {import('./item-schema.js').Item} baseItem
 * @param {Modifier} modifier
 * @returns {import('./item-schema.js').Item|null}  null if the modifier doesn't apply to this item's type
 */
export function applyModifierToItem(baseItem, modifier) {
  if (!modifier.appliesTo.includes(baseItem.itemType)) return null;

  const item = structuredClone(baseItem);
  item.passive = [...(item.passive || []), ...(modifier.passiveMods || [])];
  item.abilities = [...(item.abilities || []), ...(modifier.grantedAbilities || [])];
  if (modifier.weaponBonusDamage && item.weapon) {
    item.weapon = { ...item.weapon, bonusDamage: [...(item.weapon.bonusDamage || []), modifier.weaponBonusDamage] };
  }
  item.name = formatModifiedName(modifier.nameTemplate, baseItem.name);
  item.appliedModifiers = [...(item.appliedModifiers || []), modifier.id];
  return item;
}

/**
 * Applies several modifiers in sequence (order matters for name stacking — each modifier's
 * nameTemplate wraps the previous result's name). Skips (and reports) any modifier that doesn't
 * apply to this item's itemType rather than throwing, since a generation routine may offer a
 * shared modifier pool across multiple item types.
 * @returns {{item: import('./item-schema.js').Item, skipped: string[]}}
 */
export function applyModifiers(baseItem, modifiers) {
  let item = baseItem;
  const skipped = [];
  for (const modifier of modifiers) {
    const next = applyModifierToItem(item, modifier);
    if (next) item = next;
    else skipped.push(modifier.id);
  }
  return { item, skipped };
}
