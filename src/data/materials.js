// Base-material batch, Phase 5 of the mechanics rebuild. Two sources, both from the old
// dungeon-master-box: a small set of plain, non-monster-part crafting materials (misc catalog
// items with a genuine crafting/reagent use), plus a real monster-part-derived batch — the old
// app's MONSTER_PARTS/CREATURE_FAMILIES/PART_THEMES system, ported faithfully (not a shallow
// stand-in) to src/engine/items/monster-parts.js and run against synthetic example monsters, per
// explicit correction: "please use the old project for reference material as most of it is already
// completed and jsut needs to be moved or modified."
//
// Materials have NO mechanical facets at all (confirmed facet-table rule) — pure crafting input,
// tagged with materialTags for the crafting-related interactions (craft_material always applies;
// reagent when tagged).

import { monsterPartMaterials } from './monster-part-materials.js';

const craftMaterials = [
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

export const materials = [...craftMaterials, ...monsterPartMaterials];
