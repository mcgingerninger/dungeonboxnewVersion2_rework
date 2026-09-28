// Base-tool batch, Phase 5 of the mechanics rebuild. Sourced from the old dungeon-master-box's
// loot-data.js — all five of these existed as plain "misc" items with real proficiency/tool
// flavor text (repair capability, a stated tool proficiency, or a spellcasting-focus use), not
// invented. Kept their own names/flavor rather than remapping onto formal 5e artisan-tool-kit
// names, consistent with "use the reference project as material."
//
// Tools carry no weapon/armor/consumable facets (confirmed facet-table rule) — just a toolCategory
// tag. A masterwork tool COULD carry a small passive skill bonus (the facet table allows it) but
// none of this batch does; that's left for a future, clearly-magical/masterwork tool entry.

export const tools = [
  {
    id: 'whetstone', name: 'Whetstone', itemType: 'tool', rarity: 'common', value: '1 cp', weight: 1,
    flavorText: 'A flat rectangular stone of fine grit. Restores a blade to serviceable condition after heavy use — takes 1 minute.',
    tool: { toolCategory: 'weaponsmith' },
  },
  {
    id: 'mending-kit', name: 'Mending Kit', itemType: 'tool', rarity: 'common', value: '5 sp', weight: 1,
    flavorText: 'A bone needle, two spools of thread, and a thimble. Repairs torn clothing or leather gear — 10 minutes per item.',
    tool: { toolCategory: 'leatherworker' },
  },
  {
    id: 'tinderbox', name: 'Tinderbox', itemType: 'tool', rarity: 'common', value: '5 sp', weight: 1,
    flavorText: 'A small tin with flint, steel, and charcloth. Lights a torch or fire in 1 action in calm conditions; takes 1 minute in wind or rain.',
    tool: { toolCategory: 'fire-starting' },
  },
  {
    id: 'cartographers-surveying-set', name: "Cartographer's Surveying Set", itemType: 'tool', rarity: 'common', value: '15 gp', weight: 5,
    flavorText: "A brass sighting scope, a set of measuring chains, and a well-used sketchbook. Proficiency with it lets you produce an accurate map of any area you've thoroughly explored.",
    tool: { toolCategory: 'cartographer' },
  },
  {
    id: 'travelers-lute', name: "Traveling Minstrel's Lute", itemType: 'tool', rarity: 'common', value: '10 gp', weight: 2,
    flavorText: 'A well-traveled lute with a few new scars but a still-true sound. Proficiency with it lets you use it as a spellcasting focus (bard) or simply to play — and possibly earn a meal and a bed for the night.',
    tool: { toolCategory: 'musical_instrument' },
  },
];
