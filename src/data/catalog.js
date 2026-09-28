// A single id -> Item lookup across every base-item data file, added for Phase 6's inventory/equip
// work (equipItem/computeEquippedArmorClass/useConsumable all take a `resolveItem(itemId)`
// function, not a hardcoded list — this is that function's one real implementation). Kept as its
// own tiny module rather than folded into items-panel.js so both the read-only catalog browser and
// the real inventory UI share one source of truth instead of each hand-rolling their own lookup.

import { weapons } from './weapons.js';
import { armor } from './armor.js';
import { consumables } from './consumables.js';
import { materials } from './materials.js';
import { tools } from './tools.js';

export const allItems = [...weapons, ...armor, ...consumables, ...materials, ...tools];

const BY_ID = new Map(allItems.map(item => [item.id, item]));

export function resolveItem(itemId) {
  return BY_ID.get(itemId) || null;
}
