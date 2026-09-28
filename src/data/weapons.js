// First base-weapon batch, Phase 5 of the mechanics rebuild. Per the confirmed approach: base
// items only (no unique/one-off magic weapons — those come later as a base + Modifier
// combination, see src/engine/items/modifiers.js), one category at a time.
//
// Sourced from the old dungeon-master-box's loot-data.js as reference material (confirmed with
// the user):
// - Dagger, Handaxe, Shortbow, Quarterstaff are carried over near-verbatim (name, flavor voice,
//   gp cost, damage die) from that file's mundane starting-gear section — these are exactly the
//   old app's own "Simple Weapons," just re-expressed in the new structured schema instead of a
//   free-text `effect` string.
// - Longsword and Shortsword did NOT exist as plain mundane entries in the old data (it only ever
//   had pre-modified magic variants like "Longsword +1" and "Sword +3") — their base damage dice
//   are extrapolated directly from those entries' own numbers (e.g. "Longsword +1" is dmg
//   "1d8+1" with "Versatile (1d10+1)" in its effect text, so the unmodified base is 1d8/
//   versatile-1d10) rather than invented from scratch.
//
// Every item here passes validateItem — weapon facet only, no armor/onUse, matching the
// confirmed facet rules.

export const weapons = [
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
    id: 'shortbow', name: 'Shortbow', itemType: 'weapon', rarity: 'common', value: '25 gp', weight: 2,
    flavorText: 'A simple wooden shortbow, unstrung.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'simple', properties: ['ammunition', 'two-handed'], rangeNormal: 80, rangeMax: 320 },
  },
  {
    id: 'quarterstaff', name: 'Quarterstaff', itemType: 'weapon', rarity: 'common', value: '2 sp', weight: 4,
    flavorText: 'A sturdy six-foot hardwood staff.',
    weapon: { damageDice: '1d6', damageType: 'bludgeoning', weaponCategory: 'simple', properties: ['versatile'], versatileDice: '1d8' },
  },
  {
    id: 'javelin', name: 'Javelin', itemType: 'weapon', rarity: 'common', value: '5 sp', weight: 2,
    flavorText: 'A short light throwing spear.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'simple', properties: ['thrown'], rangeNormal: 30, rangeMax: 120 },
  },
  {
    id: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'common', value: '15 gp', weight: 3,
    flavorText: 'A well-balanced double-edged blade about three feet long.',
    weapon: { damageDice: '1d8', damageType: 'slashing', weaponCategory: 'martial', properties: ['versatile'], versatileDice: '1d10' },
  },
  {
    id: 'shortsword', name: 'Shortsword', itemType: 'weapon', rarity: 'common', value: '10 gp', weight: 2,
    flavorText: 'A short, balanced blade favoring quick, precise strikes over brute force.',
    weapon: { damageDice: '1d6', damageType: 'piercing', weaponCategory: 'martial', properties: ['finesse', 'light'] },
  },
];
