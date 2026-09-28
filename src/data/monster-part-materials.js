// Curated monster-part material batch — real output of the ported family/subtype/theme system in
// src/engine/items/monster-parts.js, run against the synthetic example-monsters.js records. Built
// with a fixed rand (always 0.5) rather than Math.random() so this batch is reproducible and
// reviewable like every other hand-authored data file (weapons/armor/consumables/tools) instead of
// generating different items on every reload — variant-label and weight/gp randomness only matters
// once there's a real "roll loot from a real monster at drop time" call site, which this rebuild
// doesn't have yet.
//
// Each entry below picks a specific eligible combine-mode part per monster (not a random one) so
// the batch shows off the real range of the ported system: a matched named subtype with its own
// theme (Wolf, Red Dragon, Skeleton) and, deliberately, one monster with no subtype match at all
// (Giant Centipede — its family falls back to the family's own plural label and base theme, e.g.
// "Beasts Toxic Sac" — a slightly odd-sounding but entirely faithful reproduction of what the old
// app itself produces for any beast without a matched named subtype, not a bug introduced here).

import { exampleMonsters } from './example-monsters.js';
import { buildMonsterPartMaterial, MONSTER_PARTS } from '../engine/items/monster-parts.js';

const fixedRand = () => 0.5;
const partById = id => MONSTER_PARTS.find(p => p.id === id);

const direWolf = exampleMonsters.find(m => m.id === 'dire-wolf');
const redDragonWyrmling = exampleMonsters.find(m => m.id === 'red-dragon-wyrmling');
const skeleton = exampleMonsters.find(m => m.id === 'skeleton');
const giantCentipede = exampleMonsters.find(m => m.id === 'giant-centipede');

export const monsterPartMaterials = [
  buildMonsterPartMaterial(direWolf, 'common', partById('claw'), fixedRand),
  buildMonsterPartMaterial(redDragonWyrmling, 'rare', partById('wing'), fixedRand),
  buildMonsterPartMaterial(skeleton, 'common', partById('bone'), fixedRand),
  buildMonsterPartMaterial(giantCentipede, 'uncommon', partById('venomsac'), fixedRand),
];
