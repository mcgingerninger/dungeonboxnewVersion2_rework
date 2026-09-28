// First base-armor batch, Phase 5 of the mechanics rebuild. Same approach as weapons.js: base
// items only, sourced from the old dungeon-master-box's loot-data.js as reference where it had a
// plain mundane entry, extrapolated from that file's own magic-variant numbers where it didn't.
//
// - Leather Armor is carried over near-verbatim from "Worn Leather Armor" (the old file's only
//   plain mundane armor entry) — AC 11 + Dex, light, no Stealth disadvantage.
// - Wooden Shield is carried over from "Cracked Wooden Shield" (dropping the "cracked"/fragile
//   flavor, which was really that specific instance's own wear-and-tear, not a property of
//   shields generally) — a shield's baseAC is the ADDITIVE bonus it contributes (+2), not a
//   replacement AC the way body armor's baseAC is; addsDexMod is always false for a shield.
// - Chain Shirt (medium) and Chain Mail (heavy) did not exist as plain mundane entries in the old
//   data — the old file's "Mithral Chain Shirt" and "Smoldering Armor" ("AC 16 (standard chain
//   mail AC)") name-check them but only ever as already-enchanted variants. Base numbers here
//   follow the standard AC/dex-cap convention those entries themselves reference rather than
//   inventing new ones.

export const armor = [
  {
    id: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'common', value: '10 gp', weight: 10,
    flavorText: 'Soft leather armor, boiled and shaped to the body.',
    armor: { armorType: 'light', baseAC: 11, addsDexMod: true, slot: 'chest' },
  },
  {
    id: 'chain-shirt', name: 'Chain Shirt', itemType: 'armor', rarity: 'common', value: '50 gp', weight: 20,
    flavorText: 'A shirt of interlocking metal rings worn under a tunic.',
    armor: { armorType: 'medium', baseAC: 13, addsDexMod: true, dexModCap: 2, slot: 'chest' },
  },
  {
    id: 'chain-mail', name: 'Chain Mail', itemType: 'armor', rarity: 'common', value: '75 gp', weight: 55,
    flavorText: 'Heavy interlocking metal rings covering the torso and limbs.',
    armor: { armorType: 'heavy', baseAC: 16, addsDexMod: false, slot: 'chest' },
  },
  {
    id: 'wooden-shield', name: 'Wooden Shield', itemType: 'armor', rarity: 'common', value: '5 sp', weight: 6,
    flavorText: 'A round shield of banded wood with an iron rim.',
    armor: { armorType: 'shield', baseAC: 2, addsDexMod: false, slot: 'shield' },
  },
];
