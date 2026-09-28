// "What can this item be used FOR" — same layering idea as the old game-engine.js's INTERACTIONS
// (kept deliberately separate from the item's type/facets, which describe what it IS/HAS), but
// re-derived against the new structured schema instead of ported verbatim, for two reasons:
//   1. Field names changed (itemType/weapon/armor/consumable facets, not type/subcategory/effect).
//   2. Several of the old rules matched free text with regex (attune checked /requires
//      attunement/i against flavor text; spell_focus/place/weapon_coating similarly regexed
//      names/descriptions) — exactly the pattern this whole rebuild exists to eliminate. Every
//      rule here reads only structured fields.
// Narrowed to what's relevant for weapon/armor/consumable (confirmed scope for this phase) — the
// old registry's ~15 material/crafting/quest-specific entries (weapon_material, reagent, enchant-
// via-socket, monster_material, fleshmancer_input, quest_item, etc.) return once those item types
// get designed. One real gap found while re-deriving this: the old registry had no interaction
// for scrolls at all (`consume` only ever matched potion/food) — added `read` below.

export const INTERACTIONS = {
  equip: {
    cat: 'Equipment', label: 'Equip',
    default: it => it.itemType === 'weapon' || it.itemType === 'armor',
  },
  attune: {
    cat: 'Equipment', label: 'Attune',
    default: it => (it.itemType === 'weapon' || it.itemType === 'armor') && !!it.requiresAttunement,
  },
  enchant: {
    cat: 'Modification', label: 'Enchant',
    default: it => it.itemType === 'weapon' || it.itemType === 'armor',
  },
  repair: {
    cat: 'Modification', label: 'Repair',
    default: it => it.itemType === 'weapon' || it.itemType === 'armor',
  },
  salvage: {
    cat: 'Processing', label: 'Salvage',
    default: it => it.itemType === 'weapon' || it.itemType === 'armor',
  },
  consume: {
    cat: 'Consumable', label: 'Consume',
    default: it => it.itemType === 'consumable' && ['potion', 'food'].includes(it.consumable?.consumableCategory),
  },
  // Broadened beyond self-use so a potion/food/topical item can also be administered to someone
  // else (e.g. a DM feeding a healing potion to a downed ally) — same reasoning the old registry's
  // `apply` already used, just off a structured category instead of a name regex for oil/ointment.
  apply: {
    cat: 'Consumable', label: 'Apply',
    default: it => it.itemType === 'consumable' && ['potion', 'food', 'topical'].includes(it.consumable?.consumableCategory),
  },
  read: {
    cat: 'Consumable', label: 'Read',
    default: it => it.itemType === 'consumable' && it.consumable?.consumableCategory === 'scroll',
  },
  crumble: {
    cat: 'Consumable', label: 'Crumbles When Spent',
    default: it => it.itemType === 'consumable' && (it.consumable?.effects || []).some(e => e.consumesItem),
  },
  throw: {
    cat: 'Combat', label: 'Throw',
    default: it => (it.itemType === 'weapon' && (it.weapon?.properties || []).includes('thrown'))
      || (it.itemType === 'consumable' && it.consumable?.consumableCategory === 'thrown'),
  },
  weapon_coating: {
    cat: 'Combat', label: 'Weapon Coating',
    default: it => it.itemType === 'consumable' && it.consumable?.consumableCategory === 'coating',
  },
};

export function computeItemInteractions(item) {
  const set = new Set();
  for (const action in INTERACTIONS) {
    if (INTERACTIONS[action].default(item)) set.add(action);
  }
  (item.extraInteractions || []).forEach(a => set.add(a));
  (item.blockedInteractions || []).forEach(a => set.delete(a));
  return [...set];
}

export function canInteract(item, action) {
  if (!item || !INTERACTIONS[action]) return false;
  const list = item.interactions || computeItemInteractions(item);
  return list.includes(action);
}
