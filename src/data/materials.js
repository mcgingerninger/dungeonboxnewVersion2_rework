// Base-material batch, Phase 5 of the mechanics rebuild. Same reference-data approach as the
// other categories — sourced from the old dungeon-master-box's loot-data.js.
//
// Important scope note (confirmed by re-checking the reference data before building this): the
// old app's "materials" are almost entirely monster-part-derived — MONSTER_PARTS in the old
// monolith procedurally generates every crafting material (claws, hides, fangs, etc.) from a
// SPECIFIC monster's anatomy at drop time, flavored per-monster (a fire elemental's "claw"
// becomes "Ember Claw", a snake's "fang" becomes "Hollow Fang"). That entire system has no
// equivalent to port yet, because it depends on a monster/NPC system this rebuild hasn't re-added
// (that's Phase 7.2+ — see the plan). Rather than fake a shallow version of it now, this batch is
// deliberately smaller: just the non-monster-part crafting materials that exist as plain static
// catalog entries in the old data (misc items with a genuine crafting/reagent use, not tied to
// any monster). The real monster-part material system returns once NPCs/monsters do.
//
// Materials have NO mechanical facets at all (confirmed facet-table rule) — pure crafting input,
// tagged with materialTags for the crafting-related interactions (craft_material always applies;
// reagent when tagged).

export const materials = [
  {
    id: 'dried-herbs', name: 'Dried Herbs (bundle)', itemType: 'material', rarity: 'common', value: '1 gp', weight: 0.5,
    flavorText: 'Dried herbs tied with twine. Possibly culinary, possibly medicinal. Substitutes for one Herbalism Kit use.',
    material: { materialTags: ['reagent'] },
  },
  {
    id: 'beeswax-block', name: 'Beeswax Block', itemType: 'material', rarity: 'common', value: '2 sp', weight: 0.25,
    flavorText: 'A thumb-sized block of golden beeswax. Waterproofs thread, seals small containers, or takes a wax key impression. Also a fire accelerant.',
    material: { materialTags: ['craft_material'] },
  },
  {
    id: 'ball-of-twine', name: 'Ball of Twine', itemType: 'material', rarity: 'common', value: '1 cp', weight: 0.5,
    flavorText: 'A ball of coarse brown twine, roughly 30-40 ft. of usable cordage — lighter and thinner than rope, not suitable for climbing, but fine for binding or rigging simple traps.',
    material: { materialTags: ['craft_material'] },
  },
];
