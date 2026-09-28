// Synthetic, monster-SHAPED example records — {name, type, size, speed, traits, actions}, the same
// shape monster-parts.js's family/subtype/theme resolution reads. No real monster/NPC system
// exists yet in this rebuild (that's Phase 7.2+), so these stand in to prove the ported part
// generator against real (if made-up) data now, same pattern already used for the Phase 3 demo
// combat and the Phase 5 demo-target consumable work. Flavor text deliberately mentions real
// anatomy words (claws, fangs, tail, wings, ...) since monster-parts.js's eligibility checks are
// regex-on-text, same technique the old app's own monster records relied on.

export const exampleMonsters = [
  {
    id: 'dire-wolf', name: 'Dire Wolf', type: 'beast', size: 'Large', speed: '50 ft.',
    traits: [
      { name: 'Keen Hearing and Smell', text: 'The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.' },
      { name: 'Pack Tactics', text: "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature." },
    ],
    actions: [
      { name: 'Bite', text: "Melee Weapon Attack. The wolf's fangs close on the target as its claws rake for purchase, its bushy tail lashing for balance." },
    ],
  },
  {
    id: 'red-dragon-wyrmling', name: 'Red Dragon Wyrmling', type: 'dragon', size: 'Medium', speed: '30 ft., climb 30 ft., fly 60 ft.',
    traits: [],
    actions: [
      { name: 'Bite', text: 'Melee Weapon Attack. The wyrmling bites with its fangs while its claws rake at the target, its scaled tail lashing and wings snapping open, curved horns lowered.' },
    ],
  },
  {
    id: 'skeleton', name: 'Skeleton', type: 'undead', size: 'Medium', speed: '30 ft.',
    traits: [],
    actions: [
      { name: 'Shortsword', text: "Melee Weapon Attack. The skeleton's bony frame rattles as it swings, bare rib bones and a grinning jawbone all that's left of it." },
    ],
  },
  {
    id: 'giant-centipede', name: 'Giant Centipede', type: 'beast', size: 'Small', speed: '30 ft., climb 30 ft.',
    traits: [],
    actions: [
      { name: 'Bite', text: 'Melee Weapon Attack. The centipede bites, injecting venom from its stinger-tipped tail as its many legs skitter and its whip-like tail flicks.' },
    ],
  },
];
