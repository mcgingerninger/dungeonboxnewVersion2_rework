// Base-weapon batch, Phase 5 of the mechanics rebuild. Per the confirmed approach: base items
// only (no unique/one-off magic weapons — those come later as a base + Modifier combination, see
// src/engine/items/modifiers.js), one category at a time.
//
// Sourced from the old dungeon-master-box's loot-data.js (confirmed: the actively-developed
// migration fork, not the older, less-current "Dungeon Loot Tool" folder also on the Desktop) —
// specifically its `common` tier, which holds all of the mundane starting gear. An earlier pass
// at this file only read the first half of that tier and missed a whole block of martial weapons
// (the "Iron Shortsword"/"Iron Longsword"/etc. set) — this revision reads the complete tier.
//
// - Dagger, Handaxe, Sling, Shortbow, Club, Spear, Javelin, Quarterstaff, Small Knife carry over
//   the old file's own mundane simple-weapon entries near-verbatim (flavor voice, gp cost,
//   damage die).
// - Longsword, Shortsword, Mace, Battleaxe, Warhammer are grounded in the old file's "Iron
//   Shortsword"/"Iron Longsword"/"Iron Mace"/"Iron Battleaxe"/"Iron Warhammer" entries — real
//   mundane martial-weapon stat blocks that exist in the data (just branded with an "Iron"
//   material prefix as flavor, the way a real longsword's stats don't change based on what metal
//   it's forged from) — dropping the material prefix since a material-driven variant (Iron vs.
//   Steel vs. Mithral vs. Adamantine) reads as exactly the kind of thing the Modifier system
//   (modifiers.js) should express later, not a distinct base item. "Iron Dagger" and "Iron Spear"
//   were skipped as pure stat duplicates of the plain Dagger/Spear entries above.
//
// Every item here passes validateItem — weapon facet only, no armor/onUse, matching the
// confirmed facet rules.

export const weapons = [
  // ---------- Simple ----------
  {
    id: 'dagger', name: 'Dagger', itemType: 'weapon', rarity: 'common', value: '2 gp', weight: 1,
    flavorText: 'A double-edged blade about a foot long with a simple crossguard.',
    weapon: { damageDice: '1d4', damageType: 'piercing', weaponCategory: 'simple', properties: ['finesse', 'light', 'thrown'], rangeNormal: 20, rangeMax: 60 },
  },
  {
    id: 'handaxe', name: 'Handaxe', itemType: 'weapon', rarity: 'common', value: '5 gp', weight: 2,
    flavorText: 'A single-bladed hatchet with a worn hickory handle.',
    weapon: { damageDice: '1d6', damageType: 'slashing', weaponCategory: 'simple', properties: ['light', 'thrown'], rangeNormal: 20, rangeMax: 60 },
  },
  {
    id: 'sling', name: 'Sling', itemType: 'weapon', rarity: 'common', value: '1 sp', weight: 0,
    flavorText: 'A braided leather strip with a small pouch. Can fling stones lethally.',
    weapon: { damageDice: '1d4', damageType: 'bludgeoning', weaponCategory: 'simple', properties: ['ammunition'], rangeNormal: 30, rangeMax: 120 },
  },
  {
    id: 'shortbow', name: 'Shortbow', itemType: 'weapon', rarity: 'common', value: '25 gp', weight: 2,
    flavorText: 'A simple wooden shortbow, unstrung.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'simple', properties: ['ammunition', 'two-handed'], rangeNormal: 80, rangeMax: 320 },
  },
  {
    id: 'club', name: 'Club', itemType: 'weapon', rarity: 'common', value: '1 sp', weight: 2,
    flavorText: 'A stout length of hardwood, heavy at one end.',
    weapon: { damageDice: '1d4', damageType: 'bludgeoning', weaponCategory: 'simple', properties: ['light'] },
  },
  {
    id: 'spear', name: 'Spear', itemType: 'weapon', rarity: 'common', value: '1 gp', weight: 3,
    flavorText: 'A six-foot ash shaft tipped with an iron point.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'simple', properties: ['thrown', 'versatile'], versatileDice: '1d8', rangeNormal: 20, rangeMax: 60 },
  },
  {
    id: 'javelin', name: 'Javelin', itemType: 'weapon', rarity: 'common', value: '5 sp', weight: 2,
    flavorText: 'A short light throwing spear.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'simple', properties: ['thrown'], rangeNormal: 30, rangeMax: 120 },
  },
  {
    id: 'quarterstaff', name: 'Quarterstaff', itemType: 'weapon', rarity: 'common', value: '2 sp', weight: 4,
    flavorText: 'A sturdy six-foot hardwood staff.',
    weapon: { damageDice: '1d6', damageType: 'bludgeoning', weaponCategory: 'simple', properties: ['versatile'], versatileDice: '1d8' },
  },
  {
    id: 'small-knife', name: 'Small Knife', itemType: 'weapon', rarity: 'common', value: '2 sp', weight: 0,
    flavorText: 'A short single-edged knife for eating or whittling.',
    weapon: { damageDice: '1d4', damageType: 'piercing', weaponCategory: 'simple', properties: ['finesse', 'light'] },
  },

  // ---------- Martial ----------
  {
    id: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'common', value: '15 gp', weight: 3,
    flavorText: 'A well-balanced double-edged blade about a yard long.',
    weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: ['versatile'], versatileDice: '1d10' },
  },
  {
    id: 'shortsword', name: 'Shortsword', itemType: 'weapon', rarity: 'common', value: '10 gp', weight: 2,
    flavorText: 'A short, balanced blade favoring quick, precise strikes over brute force.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'martial', properties: ['finesse', 'light'] },
  },
  {
    id: 'mace', name: 'Mace', itemType: 'weapon', rarity: 'common', value: '5 gp', weight: 4,
    flavorText: 'A flanged metal head on a sturdy haft.',
    weapon: { damageDice: '1d6', damageType: 'bludgeoning', weaponCategory: 'martial', properties: [] },
  },
  {
    id: 'battleaxe', name: 'Battleaxe', itemType: 'weapon', rarity: 'common', value: '10 gp', weight: 4,
    flavorText: 'A broad single-bladed axe head on a long haft.',
    weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: ['versatile'], versatileDice: '1d10' },
  },
  {
    id: 'warhammer', name: 'Warhammer', itemType: 'weapon', rarity: 'common', value: '15 gp', weight: 5,
    flavorText: 'A heavy square hammerhead built for crushing blows.',
    weapon: { damageDice: '1d8', damageType: 'bludgeoning', weaponCategory: 'martial', properties: ['versatile'], versatileDice: '1d10' },
  },
];
