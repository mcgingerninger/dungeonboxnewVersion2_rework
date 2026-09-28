// Phase 6 of the mechanics rebuild: real equip/unequip + inventory-aware AC, replacing the old
// app's SLOT_CATEGORY/collectEquippedAcBreakdown (dungeon_loot_wheel_v102_spell_details.html) —
// the SLOT structure and the "body armor sets a base, everything else adds on top" approach are
// ported directly (not reinvented), but the actual math is real (structured item fields) instead
// of collectEquippedAcBreakdown's runtime regex over "+N AC" strings — that regex-on-prose pattern
// is exactly what this whole rebuild exists to eliminate (see the rebuild plan's audit notes).
//
// EQUIPMENT_SLOTS is a scoped-down subset of the old app's real 24-slot SLOT_CATEGORY: only the
// slots this rebuild's weapon/armor items can actually target today (no ring/amulet/charm/limb/
// companion — those return once the still-deferred wondrous/Fleshmancer-equivalent item types
// exist to occupy them).
//
// Pure functions throughout, same discipline as dice.js/attack.js/consume.js — nothing here reads
// the DOM or persistence; a caller (the inventory UI) is responsible for saving the resulting
// equippedSlots/inventory back to the character record.

import { computeDerivedSheet } from './character-sheet.js';
import { collectStatMods, sumModifier } from './stat-modifiers.js';

export const EQUIPMENT_SLOTS = {
  weapon1: 'Weapon 1', weapon2: 'Weapon 2',
  armor: 'Armor (Body)', shield: 'Shield',
  helmet: 'Helmet', handwear: 'Hand Wear', boots: 'Boots', leggings: 'Leggings',
  facewear: 'Face Wear', cloak: 'Cloak', beltwaist: 'Belt',
};

// item-schema.js's ArmorData.slot uses 'chest' for body armor (its own established vocabulary,
// carried from the Phase 5 batch's reference data) — the old app's SLOT_CATEGORY key for the same
// concept was 'armor'. Mapped once here rather than renaming either existing vocabulary.
const ARMOR_SLOT_TO_EQUIPMENT_SLOT = {
  chest: 'armor', shield: 'shield', helmet: 'helmet', handwear: 'handwear',
  boots: 'boots', leggings: 'leggings', facewear: 'facewear', cloak: 'cloak', beltwaist: 'beltwaist',
};

function isTwoHanded(item) {
  return item.itemType === 'weapon' && (item.weapon?.properties || []).includes('two-handed');
}

// Which EQUIPMENT_SLOTS id(s) an item could go into — a weapon can go in either hand slot (the
// caller picks which); a two-handed weapon still targets one slot here, equipItem below mirrors it
// into the other. Armor targets exactly the one slot its own armor.slot names. Anything else
// (consumable/material/tool) is never equippable, matching interactions.js's `equip` rule.
export function equipmentSlotsForItem(item) {
  if (item.itemType === 'weapon') return ['weapon1', 'weapon2'];
  if (item.itemType === 'armor') {
    const slot = ARMOR_SLOT_TO_EQUIPMENT_SLOT[item.armor?.slot];
    return slot ? [slot] : [];
  }
  return [];
}

export function canEquipToSlot(item, slotId) {
  return equipmentSlotsForItem(item).includes(slotId);
}

function findEntry(inventory, instanceId) {
  return inventory.find(e => e.instanceId === instanceId) || null;
}

/**
 * Equips an already-owned inventory instance into a slot. Pure — returns a NEW equippedSlots
 * object; the caller decides what to persist. A two-handed weapon equipped into weapon1 or
 * weapon2 mirrors into the other slot too (occupying both hands), matching 5e; equipping anything
 * else into that other slot later naturally displaces the mirrored entry via the normal
 * single-slot overwrite below.
 * @param {Object} equippedSlots  // { [slotId]: instanceId|null }
 * @param {Array} inventory       // [{instanceId, itemId, usesLeft?}, ...]
 * @param {string} instanceId
 * @param {string} slotId
 * @param {(itemId: string) => Object} resolveItem
 */
export function equipItem(equippedSlots, inventory, instanceId, slotId, resolveItem) {
  const entry = findEntry(inventory, instanceId);
  if (!entry) throw new Error(`No inventory entry with instanceId "${instanceId}"`);
  const item = resolveItem(entry.itemId);
  if (!item) throw new Error(`Unknown item id "${entry.itemId}"`);
  if (!canEquipToSlot(item, slotId)) {
    throw new Error(`"${item.name}" cannot be equipped to slot "${slotId}"`);
  }
  const next = { ...equippedSlots, [slotId]: instanceId };
  if (isTwoHanded(item)) {
    next[slotId === 'weapon1' ? 'weapon2' : 'weapon1'] = instanceId;
  }
  return next;
}

/**
 * Clears a slot (the item stays in `inventory`, just no longer equipped anywhere). If the slot
 * held one half of a two-handed weapon's mirrored pair, clears the other half too.
 */
export function unequipSlot(equippedSlots, slotId) {
  const next = { ...equippedSlots };
  const instanceId = next[slotId];
  next[slotId] = null;
  if (instanceId && (slotId === 'weapon1' || slotId === 'weapon2')) {
    const otherSlot = slotId === 'weapon1' ? 'weapon2' : 'weapon1';
    if (next[otherSlot] === instanceId) next[otherSlot] = null;
  }
  return next;
}

// Distinct equipped items (a two-handed weapon's mirrored weapon1+weapon2 entry counts once, not
// twice) — what AC/trait aggregation below actually needs; per-slot UI rendering reads
// equippedSlots directly instead.
export function collectDistinctEquippedItems(equippedSlots, inventory, resolveItem) {
  const seen = new Set();
  const items = [];
  for (const instanceId of Object.values(equippedSlots)) {
    if (!instanceId || seen.has(instanceId)) continue;
    seen.add(instanceId);
    const entry = findEntry(inventory, instanceId);
    const item = entry && resolveItem(entry.itemId);
    if (item) items.push(item);
  }
  return items;
}

// Turns each equipped item's `passive` StatModifiers into a synthetic trait — reusing
// computeDerivedSheet's existing trait-merge math exactly as item-schema.js's Grants comment
// always intended ("same shape as a character's own traits... merges into computeDerivedSheet's
// trait list while equipped"), rather than building a parallel stat pipeline for equipment. This
// is what makes an equipped item's ability-score/skill/save/attackRoll/damageRoll/speed/hp_max
// bonuses all work for free, with zero new math — only AC (below) needs real new logic, because
// body armor REPLACES the base-10 formula instead of adding to it.
export function collectEquippedTraits(equippedSlots, inventory, resolveItem) {
  return collectDistinctEquippedItems(equippedSlots, inventory, resolveItem)
    .filter(item => (item.passive || []).length)
    .map(item => ({ id: `equip-${item.id}`, name: item.name, description: '', statMods: item.passive }));
}

/**
 * Real AC math off equipped armor, replacing the old app's collectEquippedAcBreakdown's
 * regex-on-"+N AC"-text approach with structured fields, same base-vs-additive structure: body
 * armor (equippedSlots.armor) sets the base AC and gates whether/how much Dex applies
 * (armor.addsDexMod/dexModCap); everything else equipped that's `additive` (shield, helm,
 * gauntlets, greaves, boots — Phase 5's armor.js) adds its own baseAC on top; `flatAcBonus` folds
 * in any 'ac' StatModifier from traits/equipped-item passives the caller already collected
 * (computeEquippedArmorClass doesn't read character.traits itself, to stay decoupled from that
 * shape — see computeDerivedSheetWithEquipment below for how a caller assembles it).
 */
export function computeEquippedArmorClass({ equippedSlots, inventory, resolveItem, dexModifier, flatAcBonus = 0 }) {
  const bodyEntry = equippedSlots.armor ? findEntry(inventory, equippedSlots.armor) : null;
  const bodyArmor = bodyEntry && resolveItem(bodyEntry.itemId);
  let base = 10;
  let baseSource = null;
  let dexContribution = dexModifier;
  if (bodyArmor && bodyArmor.itemType === 'armor' && !bodyArmor.armor.additive) {
    base = bodyArmor.armor.baseAC;
    baseSource = bodyArmor.name;
    if (!bodyArmor.armor.addsDexMod) dexContribution = 0;
    else if (typeof bodyArmor.armor.dexModCap === 'number') dexContribution = Math.min(dexModifier, bodyArmor.armor.dexModCap);
  }
  const additiveSources = [];
  for (const [slotId, instanceId] of Object.entries(equippedSlots)) {
    if (slotId === 'armor' || !instanceId) continue;
    const entry = findEntry(inventory, instanceId);
    const item = entry && resolveItem(entry.itemId);
    if (!item || item.itemType !== 'armor' || !item.armor.additive) continue;
    additiveSources.push({ itemName: item.name, amount: item.armor.baseAC });
  }
  const additiveTotal = additiveSources.reduce((sum, s) => sum + s.amount, 0);
  const total = base + dexContribution + additiveTotal + flatAcBonus;
  return { total, base, baseSource, dexContribution, additiveSources, flatAcBonus };
}

/**
 * The Phase 6 combined sheet: computeDerivedSheet (Phase 2, unchanged) already handles every
 * equipment bonus generically once equipped items' passives are folded into `traits` — this only
 * has to special-case AC, since armor replaces the base-10 formula rather than adding to it.
 * @param {Object} character       // same shape computeDerivedSheet takes
 * @param {Object} equippedSlots
 * @param {Array} inventory
 * @param {(itemId: string) => Object} resolveItem
 */
export function computeDerivedSheetWithEquipment(character, equippedSlots, inventory, resolveItem) {
  const equippedTraits = collectEquippedTraits(equippedSlots, inventory, resolveItem);
  const mergedTraits = [...(character.traits || []), ...equippedTraits];
  const derived = computeDerivedSheet({ ...character, traits: mergedTraits });
  const flatAcBonus = sumModifier(collectStatMods(mergedTraits), 'ac');
  const acField = computeEquippedArmorClass({
    equippedSlots, inventory, resolveItem, dexModifier: derived.abilityModifiers.dex, flatAcBonus,
  });
  return { ...derived, ac: acField.total, acBreakdown: acField, equippedTraits };
}
