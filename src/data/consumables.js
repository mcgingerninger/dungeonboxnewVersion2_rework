// Base-consumable batch, Phase 5 of the mechanics rebuild. Same approach as weapons.js/armor.js —
// sourced from the old dungeon-master-box's loot-data.js (confirmed: the actively-developed
// migration fork), across its full common/uncommon tiers this time (consumables — unlike
// mundane weapons/armor — are spread across tiers rather than concentrated in `common`).
//
// Unlike weapons/armor, the old data does NOT model potions as a base+modifier system at all —
// "Potion of Healing" and "Potion of Greater Healing" are each authored as fully separate catalog
// entries, not one base potion with a "Greater" modifier applied. This batch mirrors that: each
// tier is its own base item, not a modifier (the modifier-pool question is paused anyway — see
// modifiers.js).
//
// A couple of items here (Vial of Antitoxin, Corked Vial of Spirits) have real mechanical effects
// the old data describes as "advantage on X" — not a flat numeric bonus, so not representable by
// the current StatModifier vocabulary (the same non-numeric-effect gap flagged and paused for the
// modifier pool). Rather than force a wrong numeric approximation, those items' effects carry an
// empty statMods array and the real mechanical detail lives in flavorText, honestly marked as not
// yet simulated — consistent with how the paused modifier work is being handled.
//
// Every item here passes validateItem — consumable facet only, matching the confirmed facet rules.

export const consumables = [
  {
    id: 'potion-of-healing', name: 'Potion of Healing', itemType: 'consumable', rarity: 'common', value: '150 gp', weight: 0.5,
    flavorText: 'A glass vial of faintly glowing pink liquid with a sweet, coppery taste. The most common magical item in existence.',
    consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '2d4+2', consumesItem: true }] },
  },
  {
    id: 'potion-of-greater-healing', name: 'Potion of Greater Healing', itemType: 'consumable', rarity: 'uncommon', value: '150 gp', weight: 0.5,
    flavorText: 'A vibrant red potion, noticeably warmer than it should be.',
    consumable: { consumableCategory: 'potion', effects: [{ kind: 'heal', healDice: '4d4+4', consumesItem: true }] },
  },
  {
    id: 'iron-rations', name: 'Iron Rations (1 day)', itemType: 'consumable', rarity: 'common', value: '5 sp', weight: 2,
    flavorText: 'Hard tack and dried salted meat in a wax block.',
    consumable: { consumableCategory: 'food', effects: [{ kind: 'utility', consumesItem: true }] },
  },
  {
    id: 'scroll-of-fireball', name: 'Scroll of Fireball', itemType: 'consumable', rarity: 'uncommon', value: '300 gp', weight: 0,
    flavorText: 'Parchment inscribed with a glowing sigil. Reading it unleashes a sphere of flame.',
    consumable: { consumableCategory: 'scroll', effects: [{ kind: 'damage', damageDice: '8d6', damageType: 'fire', consumesItem: true }] },
  },
  {
    id: 'alchemists-fire', name: "Alchemist's Fire (flask)", itemType: 'consumable', rarity: 'common', value: '150 gp', weight: 1,
    flavorText: 'A volatile green liquid that ignites when shattered. Thrown, range 20 ft.; a DC 10 Dexterity action extinguishes it before it can burn again next turn (that repeat-burn detail isn\'t simulated yet — see the module comment above).',
    consumable: { consumableCategory: 'thrown', effects: [{ kind: 'damage', damageDice: '1d4', damageType: 'fire', consumesItem: true }] },
  },
  {
    id: 'vial-of-antitoxin', name: 'Vial of Antitoxin', itemType: 'consumable', rarity: 'common', value: '150 gp', weight: 0.5,
    flavorText: 'A clear bitter liquid that neutralizes common poisons. Advantage on saving throws against poison for 1 hour — the advantage itself isn\'t simulated numerically yet (see the module comment above); does not remove existing effects.',
    consumable: { consumableCategory: 'potion', effects: [{ kind: 'buff', statMods: [], durationMs: 3600000, consumesItem: true }] },
  },
  {
    id: 'corked-vial-of-spirits', name: 'Corked Vial of Spirits', itemType: 'consumable', rarity: 'common', value: '3 cp', weight: 0,
    flavorText: 'A finger-sized glass vial of clear or amber spirits, tightly corked. Strong enough to sterilize a wound. Apply to a wound: advantage on Con saves vs. infection (GM discretion, not simulated numerically yet). Two uses in the original design; modeled here as single-use pending a real charges/uses mechanic for consumables.',
    consumable: { consumableCategory: 'topical', effects: [{ kind: 'buff', statMods: [], durationMs: 3600000, consumesItem: true }] },
  },
];
