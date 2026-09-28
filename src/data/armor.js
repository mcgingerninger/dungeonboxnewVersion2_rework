// Base-armor batch, Phase 5 of the mechanics rebuild. Same approach as weapons.js — base items
// only, sourced from the old dungeon-master-box's `common` tier (confirmed: the actively-
// developed migration fork). An earlier pass at this file only read half the tier and missed a
// full accessory-armor set (helm/gauntlets/greaves/boots) plus the only real heavy-armor
// reference in the mundane data — this revision reads the complete tier.
//
// - Leather Armor carries over "Worn Leather Armor" (the old file's only plain mundane BODY
//   armor entry) near-verbatim — AC 11 + Dex, light, no Stealth disadvantage.
// - Wooden Shield carries over "Cracked Wooden Shield", dropping the "cracked"/fragile flavor
//   (that instance's own wear-and-tear, not a property of shields generally).
// - Plate Armor, Plate Helm, Plate Gauntlets, Plate Greaves, Plate Boots are grounded in the old
//   file's "Iron Plate Armor/Helm/Gauntlets/Greaves/Boots" set — dropping the "Iron" material
//   prefix for the same reason weapons.js drops it (a material variant reads as Modifier-system
//   territory, not a distinct base item). Plate Armor is the only REAL heavy-armor reference in
//   the mundane data and is the first item here with a Strength requirement / Stealth
//   disadvantage, which the schema didn't have fields for until this batch surfaced the need
//   (added strengthRequirement/stealthDisadvantage to ArmorData in item-schema.js).
// - Chain Shirt (medium) has no plain mundane entry in the old data, but IS grounded in a real
//   reference: "Armor of Gleaming"'s own text is explicit — "AC 13 + Dex modifier (max 2)... as a
//   chain shirt" — so these are that magic item's own stated base numbers, not invented.
// - Studded Leather is grounded in "Glamoured Studded Leather" (AC 12 + Dex, light) — matching
//   the standard convention; a second old-data reference ("Cast-Off Armor", "as studded leather"
//   but AC 13/capped) contradicts it and reads as an authoring slip in the old file (those numbers
//   describe a medium armor, not studded leather), so it's not used as the source here.
//
// "Iron Plate Shield" was skipped as a stat-identical duplicate of Wooden Shield (+2 AC, same
// slot) — same reasoning weapons.js skipped "Iron Dagger"/"Iron Spear".

export const armor = [
  {
    id: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'common', value: '10 gp', weight: 10,
    flavorText: 'Soft leather armor, boiled and shaped to the body.',
    armor: { armorType: 'light', baseAC: 11, addsDexMod: true, slot: 'chest' },
  },
  {
    id: 'studded-leather', name: 'Studded Leather', itemType: 'armor', rarity: 'common', value: '45 gp', weight: 13,
    flavorText: 'Sturdy leather reinforced with close-set rivets and small metal studs.',
    armor: { armorType: 'light', baseAC: 12, addsDexMod: true, slot: 'chest' },
  },
  {
    id: 'chain-shirt', name: 'Chain Shirt', itemType: 'armor', rarity: 'common', value: '50 gp', weight: 20,
    flavorText: 'A shirt of interlocking metal rings worn under a tunic.',
    armor: { armorType: 'medium', baseAC: 13, addsDexMod: true, dexModCap: 2, slot: 'chest' },
  },
  {
    id: 'plate-armor', name: 'Plate Armor', itemType: 'armor', rarity: 'common', value: '150 gp', weight: 65,
    flavorText: 'Full plate forged and fitted to cover the torso, shoulders, and hips.',
    armor: { armorType: 'heavy', baseAC: 16, addsDexMod: false, slot: 'chest', strengthRequirement: 15, stealthDisadvantage: true },
  },
  {
    id: 'wooden-shield', name: 'Wooden Shield', itemType: 'armor', rarity: 'common', value: '5 sp', weight: 6,
    flavorText: 'A round shield of banded wood with an iron rim.',
    armor: { armorType: 'shield', baseAC: 2, addsDexMod: false, slot: 'shield', additive: true },
  },
  {
    id: 'plate-helm', name: 'Plate Helm', itemType: 'armor', rarity: 'common', value: '20 gp', weight: 4,
    flavorText: 'A full-face plate helm fitted to a matching armor set.',
    armor: { armorType: 'heavy', baseAC: 1, addsDexMod: false, slot: 'helmet', additive: true },
  },
  {
    id: 'plate-gauntlets', name: 'Plate Gauntlets', itemType: 'armor', rarity: 'common', value: '20 gp', weight: 2,
    flavorText: 'Articulated plate gauntlets, hinged at the knuckles for a full grip.',
    armor: { armorType: 'heavy', baseAC: 1, addsDexMod: false, slot: 'handwear', additive: true },
  },
  {
    id: 'plate-greaves', name: 'Plate Greaves', itemType: 'armor', rarity: 'common', value: '20 gp', weight: 4,
    flavorText: 'Plate greaves covering the thighs and shins, buckled at the sides.',
    armor: { armorType: 'heavy', baseAC: 1, addsDexMod: false, slot: 'leggings', additive: true },
  },
  {
    id: 'plate-boots', name: 'Plate Boots', itemType: 'armor', rarity: 'common', value: '20 gp', weight: 4,
    flavorText: 'Reinforced plate sabatons with articulated toe plates.',
    armor: { armorType: 'heavy', baseAC: 1, addsDexMod: false, slot: 'boots', additive: true },
  },
];
