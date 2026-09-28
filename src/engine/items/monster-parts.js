// Monster-part material generation — ported from the old dungeon-master-box's real "MONSTER PARTS
// v2" system (CREATURE_FAMILIES/CREATURE_SUBTYPES/PART_THEMES/MONSTER_PARTS/buildMonsterPartItemV2
// in the old monolith), per explicit correction: "please use the old project for reference
// material as most of it is already completed and jsut needs to be moved or modified" — an earlier
// pass at this (a flat 14-entry part list with no family/theme/eligibility logic, since deleted)
// under-delivered relative to what the old app actually has, the same mistake the weapons/armor
// batches made once before.
//
// Architecture (unchanged from the old app): a monster resolves to one of 16 FAMILIES by its base
// type string (or an anatomy-text regex for family-less cases like ghosts). Within a family, a
// NAMED SUBTYPE (Red Dragon, Vampire, Wolf, ...) is matched by keyword against the monster's own
// name; no match falls back to the family's own base theme, so every monster resolves to SOME
// theme. A THEME is a small reusable flavor (which stat an equip-mode part would boost, which
// damage type a combine-mode part is themed to) shared across many families/subtypes.
//
// Scope decision for THIS module: the old system has two part modes — 'combine' (raw crafting
// material, no mechanical effect on its own — exactly what this rebuild's `material` itemType
// models, which by the confirmed facet-table rule can carry NO mechanical facets at all) and
// 'equip' (worn as a charm, grants a real passive stat/AC bonus — that is NOT a material, it's a
// wondrous/trinket item, a category explicitly deferred at Phase 4 scoping). So this module ports
// the FULL family/subtype/theme/part architecture (all of it is genuinely reusable later), but
// only `buildMonsterPartMaterial` — which only ever builds from combine-mode parts — is wired into
// this rebuild's item data today. The equip-mode part defs and `describeEquipEffect` are kept
// ported and ready for whenever the wondrous item type gets designed.
//
// No monster/NPC system exists yet in this rebuild (that's Phase 7.2+), so every function here
// takes a plain monster-SHAPED object — {name, type, size, speed, traits, actions} — same as the
// old app's own monster records. `src/data/example-monsters.js` supplies synthetic examples to
// prove this against real (if made-up) data now; real monster records slot in later with zero
// changes to this module.

export function monsterAnatomyText(monster) {
  return [
    monster?.name || '', monster?.type || '', monster?.size || '', monster?.speed || '',
    ...(monster?.traits || []).map(x => `${x?.name || ''} ${x?.text || ''}`),
    ...(monster?.actions || []).map(x => `${x?.name || ''} ${x?.text || ''}`),
  ].join(' ').toLowerCase();
}

export function monsterIsHumanoid(monster) {
  return /humanoid|human|elf|dwarf|halfling|gnome|orc|goblin|kobold|bugbear|hobgoblin|ogre|giant|troll/.test(monsterAnatomyText(monster));
}
export function monsterIsConstruct(monster) { return /construct|golem|modron|warforged/.test(monsterAnatomyText(monster)); }
export function monsterIsElemental(monster) { return /elemental|mephit|genie|djinn|efreet|dao|marid/.test(monsterAnatomyText(monster)); }
export function monsterIsUndead(monster) { return /undead|zombie|skeleton|vampire|lich|ghoul|wight|wraith|revenant|mummy/.test(monsterAnatomyText(monster)); }
export function monsterHasFur(monster) { return /fur|furry|hair|wool|mane|pelt|bear|wolf|fox|lion|tiger|ape|cat|dog|rat|badger|boar|deer|elk|goat|ram/.test(monsterAnatomyText(monster)); }
export function monsterHasScales(monster) { return /scale|scaled|dragon|drake|kobold|lizard|serpent|snake|yuan-ti|saur/.test(monsterAnatomyText(monster)); }
export function monsterHasShell(monster) { return /shell|carapace|chitin|exoskeleton|crab|lobster|turtle|tortoise|beetle|insect|spider|scorpion/.test(monsterAnatomyText(monster)); }
export function monsterHasWings(monster) { return /wing|fly|flying|flight|hover|bat|bird|angel|demon|devil|dragon|drake|fairy|pixie|harpy|wyvern/.test(monsterAnatomyText(monster)); }
export function monsterHasTail(monster) { return /tail|stinger|snake|serpent|dragon|devil|demon|lizard|rat|cat|dog|scorpion|whip tail/.test(monsterAnatomyText(monster)); }
export function monsterHasHorns(monster) { return /horn|antler|tusk|ram|minotaur|devil|demon|tiefling|goat/.test(monsterAnatomyText(monster)); }
export function monsterHasVenom(monster) { return /venom|poison|toxic|poisonous|stinger|sting|venomous|spit poison|poison spray/.test(monsterAnatomyText(monster)); }
export function monsterHasBite(monster) { return /fang|bite|bites|teeth|tooth|canine|tusk|swallow|munch/.test(monsterAnatomyText(monster)); }
export function monsterHasClaws(monster) { return /claw|claws|pincer|talon|hooked|grasp|tentacle|raptor|scratch/.test(monsterAnatomyText(monster)); }
export function monsterIsBirdlike(monster) { return /bird|avian|eagle|hawk|owl|raven|crow|roc|harpy|aarakocra|griffon|griffin|hippogriff/.test(monsterAnatomyText(monster)); }
export function monsterIsAquaticTentacled(monster) { return /kraken|octopus|squid|aberration|tentacle|star spawn|flumph|gibbering/.test(monsterAnatomyText(monster)); }
export function monsterIsOrganic(monster) { return !monsterIsConstruct(monster) && !monsterIsElemental(monster); }

// Renamed from the old app's MANGLER_RARITY_MAGNITUDE — there's no Monster Mangler crafting system
// in this rebuild yet, but the 1-4-by-rarity power curve itself is real and worth keeping as-is.
export const PART_RARITY_MAGNITUDE = { common: 1, uncommon: 1, rare: 2, superrare: 2, legendary: 3, celestial: 4 };
export const MONSTER_PART_WEIGHT_RANGE = { common: [0.2, 2], uncommon: [0.5, 3], rare: [1, 5], superrare: [2, 8], legendary: [3, 12], celestial: [5, 20] };
export const MONSTER_PART_GP_RANGE = { common: [5, 25], uncommon: [25, 100], rare: [100, 400], superrare: [400, 1500], legendary: [1500, 6000], celestial: [6000, 20000] };

function baseCreatureTypeString(monster) {
  return String(monster?.type || '').split(' (')[0].trim().toLowerCase();
}

// Order matters: spirit is checked before undead so a ghost/wraith doesn't fall into the plain
// Undead bucket; beast is last and always matches, the ultimate fallback so every monster resolves
// to something.
export const CREATURE_FAMILIES = [
  { id: 'spirit', label: 'Spirits/Incorporeal', baseTheme: 'fear_aura',
    detect: m => /ghost|specter|spectre|wraith|phantom|shade|banshee|incorporeal/.test(monsterAnatomyText(m)) },
  { id: 'dragon', label: 'Dragons', baseTheme: 'elemental_fire', detect: m => baseCreatureTypeString(m) === 'dragon' },
  { id: 'undead', label: 'Undead', baseTheme: 'necrotic_resilience', detect: m => baseCreatureTypeString(m) === 'undead' },
  { id: 'fiend', label: 'Fiends', baseTheme: 'elemental_fire', detect: m => baseCreatureTypeString(m) === 'fiend' },
  { id: 'celestial', label: 'Celestials', baseTheme: 'radiant_grace', detect: m => baseCreatureTypeString(m) === 'celestial' },
  { id: 'fey', label: 'Fey', baseTheme: 'nature_ward', detect: m => baseCreatureTypeString(m) === 'fey' },
  { id: 'elemental', label: 'Elementals', baseTheme: 'elemental_earth', detect: m => baseCreatureTypeString(m) === 'elemental' },
  { id: 'giant', label: 'Giants', baseTheme: 'giant_might', detect: m => baseCreatureTypeString(m) === 'giant' },
  { id: 'construct', label: 'Constructs', baseTheme: 'armored_construct', detect: m => baseCreatureTypeString(m) === 'construct' },
  { id: 'plant', label: 'Plants', baseTheme: 'nature_ward', detect: m => baseCreatureTypeString(m) === 'plant' },
  { id: 'ooze', label: 'Oozes', baseTheme: 'corrosive_form', detect: m => baseCreatureTypeString(m) === 'ooze' },
  { id: 'aberration', label: 'Aberrations', baseTheme: 'psychic_mind', detect: m => baseCreatureTypeString(m) === 'aberration' },
  { id: 'monstrosity', label: 'Monstrosities', baseTheme: 'corrosive_form', detect: m => baseCreatureTypeString(m) === 'monstrosity' },
  { id: 'swarm', label: 'Swarms/Vermin', baseTheme: 'nature_ward',
    detect: m => baseCreatureTypeString(m) === 'swarm' || /swarm of|vermin/.test(monsterAnatomyText(m)) },
  { id: 'humanoid', label: 'Humanoids', baseTheme: 'primal_strength', detect: m => baseCreatureTypeString(m) === 'humanoid' },
  { id: 'beast', label: 'Beasts', baseTheme: 'primal_strength', detect: () => true },
];

export function getCreatureFamily(monster) {
  for (const fam of CREATURE_FAMILIES) { if (fam.detect(monster)) return fam; }
  return CREATURE_FAMILIES[CREATURE_FAMILIES.length - 1];
}

// Shared magical-flavor library reused across many families/subtypes. equip.stat/equip.ac describe
// what an equip-mode part would boost (kept for the future wondrous item type); combineDmgType is
// the damage flavor a combine-mode part represents once something (a future crafting system) can
// actually imbue it into gear.
export const PART_THEMES = {
  primal_strength: { label: 'Primal Might', equip: { stat: 'Strength' }, combineDmgType: 'slashing', flavor: 'raw physical power' },
  giant_might: { label: 'Giant Might', equip: { stat: 'Strength' }, combineDmgType: 'bludgeoning', flavor: 'overwhelming size and strength' },
  swift_evasion: { label: 'Swift Reflexes', equip: { stat: 'Dexterity' }, combineDmgType: 'slashing', flavor: 'uncanny speed and agility' },
  necrotic_resilience: { label: 'Deathless Resilience', equip: { stat: 'Maximum Hit Points', mult: 2 }, combineDmgType: 'necrotic', flavor: 'a body that refuses to fail' },
  arcane_intellect: { label: 'Arcane Intellect', equip: { stat: 'Intelligence' }, combineDmgType: 'force', flavor: 'a keen, calculating mind' },
  psychic_mind: { label: 'Alien Intellect', equip: { stat: 'Intelligence' }, combineDmgType: 'psychic', flavor: 'a mind bent by unknowable thought' },
  radiant_grace: { label: 'Radiant Grace', equip: { stat: 'Wisdom' }, combineDmgType: 'radiant', flavor: 'a touch of the divine' },
  nature_ward: { label: 'Wild Ward', equip: { stat: 'Wisdom' }, combineDmgType: 'poison', flavor: 'the wild, untamed and watchful' },
  lifedrain: { label: 'Vampiric Hunger', equip: { stat: 'Charisma' }, combineDmgType: 'necrotic', flavor: 'a hunger that feeds on life itself' },
  fear_aura: { label: 'Dread Presence', equip: { stat: 'Charisma' }, combineDmgType: 'psychic', flavor: 'a presence that unsettles the bravest' },
  corrosive_form: { label: 'Corrosive Form', equip: { stat: 'Constitution' }, combineDmgType: 'acid', flavor: 'a form that dissolves what it touches' },
  elemental_fire: { label: 'Elemental Fire', equip: { stat: 'Constitution' }, combineDmgType: 'fire', flavor: 'a smoldering inner heat' },
  elemental_cold: { label: 'Elemental Frost', equip: { stat: 'Constitution' }, combineDmgType: 'cold', flavor: 'a bone-deep, unnatural chill' },
  elemental_lightning: { label: 'Elemental Storm', equip: { stat: 'Dexterity' }, combineDmgType: 'lightning', flavor: 'a crackling, restless charge' },
  elemental_earth: { label: 'Elemental Stone', equip: { stat: 'Constitution' }, combineDmgType: 'bludgeoning', flavor: 'the weight and patience of stone' },
  armored_construct: { label: 'Armored Plating', equip: { ac: true }, combineDmgType: 'bludgeoning', flavor: 'plating built to endure' },
};

// First keyword match against the monster's name wins; no match falls back to the family's own
// baseTheme. Adding a new subtype later is one array entry, never a code change.
export const CREATURE_SUBTYPES = {
  dragon: [
    { keywords: ['red'], label: 'Red Dragon', theme: 'elemental_fire' },
    { keywords: ['blue'], label: 'Blue Dragon', theme: 'elemental_lightning' },
    { keywords: ['green'], label: 'Green Dragon', theme: 'nature_ward' },
    { keywords: ['black'], label: 'Black Dragon', theme: 'corrosive_form' },
    { keywords: ['white'], label: 'White Dragon', theme: 'elemental_cold' },
    { keywords: ['gold'], label: 'Gold Dragon', theme: 'radiant_grace' },
    { keywords: ['silver'], label: 'Silver Dragon', theme: 'elemental_cold' },
    { keywords: ['bronze'], label: 'Bronze Dragon', theme: 'elemental_lightning' },
    { keywords: ['copper'], label: 'Copper Dragon', theme: 'corrosive_form' },
    { keywords: ['brass'], label: 'Brass Dragon', theme: 'elemental_fire' },
  ],
  undead: [
    { keywords: ['vampire'], label: 'Vampire', theme: 'lifedrain' },
    { keywords: ['zombie'], label: 'Zombie', theme: 'necrotic_resilience' },
    { keywords: ['lich'], label: 'Lich', theme: 'arcane_intellect' },
    { keywords: ['mummy'], label: 'Mummy', theme: 'fear_aura' },
    { keywords: ['skeleton'], label: 'Skeleton', theme: 'primal_strength' },
    { keywords: ['ghoul', 'ghast'], label: 'Ghoul', theme: 'primal_strength' },
  ],
  fiend: [
    { keywords: ['devil'], label: 'Devil', theme: 'elemental_fire' },
    { keywords: ['demon'], label: 'Demon', theme: 'corrosive_form' },
    { keywords: ['imp', 'quasit'], label: 'Imp', theme: 'fear_aura' },
  ],
  celestial: [
    { keywords: ['angel', 'deva', 'planetar', 'solar'], label: 'Angel', theme: 'radiant_grace' },
    { keywords: ['unicorn'], label: 'Unicorn', theme: 'nature_ward' },
    { keywords: ['pegasus'], label: 'Pegasus', theme: 'swift_evasion' },
  ],
  fey: [
    { keywords: ['pixie', 'sprite'], label: 'Pixie', theme: 'swift_evasion' },
    { keywords: ['dryad'], label: 'Dryad', theme: 'nature_ward' },
    { keywords: ['hag'], label: 'Hag', theme: 'fear_aura' },
    { keywords: ['satyr'], label: 'Satyr', theme: 'nature_ward' },
  ],
  elemental: [
    { keywords: ['fire', 'flame', 'magma', 'efreet'], label: 'Fire Elemental', theme: 'elemental_fire' },
    { keywords: ['water', 'ice', 'frost'], label: 'Water Elemental', theme: 'elemental_cold' },
    { keywords: ['air', 'wind', 'djinn', 'invisible stalker'], label: 'Air Elemental', theme: 'elemental_lightning' },
    { keywords: ['earth', 'mud', 'dao'], label: 'Earth Elemental', theme: 'elemental_earth' },
  ],
  giant: [
    { keywords: ['hill giant'], label: 'Hill Giant', theme: 'giant_might' },
    { keywords: ['frost giant'], label: 'Frost Giant', theme: 'elemental_cold' },
    { keywords: ['fire giant'], label: 'Fire Giant', theme: 'elemental_fire' },
    { keywords: ['storm giant'], label: 'Storm Giant', theme: 'elemental_lightning' },
    { keywords: ['stone giant'], label: 'Stone Giant', theme: 'elemental_earth' },
    { keywords: ['cloud giant'], label: 'Cloud Giant', theme: 'radiant_grace' },
  ],
  construct: [
    { keywords: ['golem'], label: 'Golem', theme: 'armored_construct' },
    { keywords: ['homunculus'], label: 'Homunculus', theme: 'arcane_intellect' },
    { keywords: ['animated'], label: 'Animated Construct', theme: 'armored_construct' },
  ],
  plant: [
    { keywords: ['treant'], label: 'Treant', theme: 'giant_might' },
    { keywords: ['shambling'], label: 'Shambling Mound', theme: 'primal_strength' },
    { keywords: ['myconid'], label: 'Myconid', theme: 'nature_ward' },
  ],
  ooze: [
    { keywords: ['gelatinous'], label: 'Gelatinous Cube', theme: 'corrosive_form' },
    { keywords: ['pudding'], label: 'Black Pudding', theme: 'corrosive_form' },
    { keywords: ['jelly'], label: 'Ochre Jelly', theme: 'corrosive_form' },
  ],
  aberration: [
    { keywords: ['beholder'], label: 'Beholder', theme: 'psychic_mind' },
    { keywords: ['mind flayer', 'illithid'], label: 'Mind Flayer', theme: 'arcane_intellect' },
    { keywords: ['aboleth'], label: 'Aboleth', theme: 'psychic_mind' },
  ],
  monstrosity: [
    { keywords: ['owlbear'], label: 'Owlbear', theme: 'primal_strength' },
    { keywords: ['chimera'], label: 'Chimera', theme: 'elemental_fire' },
    { keywords: ['medusa'], label: 'Medusa', theme: 'fear_aura' },
    { keywords: ['basilisk'], label: 'Basilisk', theme: 'fear_aura' },
  ],
  swarm: [
    { keywords: ['rat'], label: 'Rat Swarm', theme: 'swift_evasion' },
    { keywords: ['insect', 'centipede', 'spider'], label: 'Insect Swarm', theme: 'nature_ward' },
  ],
  humanoid: [
    { keywords: ['elf'], label: 'Elf', theme: 'swift_evasion' },
    { keywords: ['dwarf'], label: 'Dwarf', theme: 'giant_might' },
    { keywords: ['orc'], label: 'Orc', theme: 'primal_strength' },
    { keywords: ['halfling'], label: 'Halfling', theme: 'swift_evasion' },
    { keywords: ['gnome'], label: 'Gnome', theme: 'arcane_intellect' },
  ],
  beast: [
    { keywords: ['wolf'], label: 'Wolf', theme: 'swift_evasion' },
    { keywords: ['bear'], label: 'Bear', theme: 'primal_strength' },
    { keywords: ['spider'], label: 'Spider', theme: 'nature_ward' },
    { keywords: ['snake', 'serpent'], label: 'Serpent', theme: 'nature_ward' },
  ],
};

export function getCreatureSubtype(monster, family) {
  const list = CREATURE_SUBTYPES[family.id];
  if (!list) return null;
  const name = (monster?.name || '').toLowerCase();
  return list.find(s => s.keywords.some(kw => name.includes(kw))) || null;
}

function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }

// The ~20 part definitions (10 equip, 10 combine). eligible(monster) reuses the same
// anatomy-detection helpers above; variants(monster, rand), where present, picks a per-monster-
// flavored label (a snake's "fang" reads as "Hollow Fang") instead of the flat anatomicalPart name
// — adapted from `variants(monster)` (old app called a global `ri` internally) to take an
// injectable `rand` instead, matching this rebuild's pure-function/injectable-rand convention
// (dice.js, attack.js) rather than reaching for Math.random() inside engine code.
export const MONSTER_PARTS = [
  // -- Equip (worn in a charm slot; would grant a real passive bonus — wondrous item type, not yet
  // built. Kept ported and ready; nothing in this rebuild builds from these yet.) --
  { id: 'heartstone', anatomicalPart: 'Heartstone', mode: 'equip', eligible: () => true },
  { id: 'soulfragment', anatomicalPart: 'Soul Fragment', mode: 'equip', eligible: m => ['undead', 'spirit', 'fiend', 'celestial', 'aberration'].includes(getCreatureFamily(m).id) },
  { id: 'essence', anatomicalPart: 'Essence', mode: 'equip', eligible: m => ['elemental', 'fey', 'spirit'].includes(getCreatureFamily(m).id) },
  { id: 'core', anatomicalPart: 'Core', mode: 'equip', eligible: m => ['construct', 'elemental'].includes(getCreatureFamily(m).id) },
  { id: 'eye', anatomicalPart: 'Eye', mode: 'equip', eligible: () => true, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/compound eye|many eyes|multiple eyes|eye stalk|stalked eye/.test(t)) return pick(['Compound Eye', 'Stalked Eye', 'Multifaceted Eye'], rand);
      if (/slit pupil|reptile|serpent|snake|dragon/.test(t)) return pick(['Slit-Pupil Eye', 'Reptilian Eye', 'Dragon Eye'], rand);
      if (/spider|arachnid|insect|beetle/.test(t)) return pick(['Faceted Eye', 'Beadlike Eye', 'Compound Eye'], rand);
      if (/undead|vampire|lich|wraith|ghost/.test(t)) return pick(['Unnatural Eye', 'Dead Eye', 'Spectral Eye'], rand);
      return pick(['Eye', 'Watchful Eye', 'Clear Eye'], rand);
    } },
  { id: 'feather', anatomicalPart: 'Feather', mode: 'equip', eligible: m => monsterIsBirdlike(m) || monsterHasWings(m) },
  { id: 'tooth', anatomicalPart: 'Tooth', mode: 'equip', eligible: monsterHasBite },
  { id: 'scale', anatomicalPart: 'Scale', mode: 'equip', eligible: monsterHasScales },
  { id: 'wingmembrane', anatomicalPart: 'Wing Membrane', mode: 'equip', eligible: monsterHasWings },
  { id: 'antler', anatomicalPart: 'Antler', mode: 'equip', eligible: monsterHasHorns },
  { id: 'shell', anatomicalPart: 'Shell', mode: 'equip', eligible: monsterHasShell, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/turtle|tortoise/.test(t)) return pick(['Shell', 'Carapace', 'Armored Shell'], rand);
      if (/crab|lobster/.test(t)) return pick(['Carapace', 'Chitin Plate', 'Armored Carapace'], rand);
      return pick(['Shell', 'Carapace', 'Chitin Plate', 'Exoskeletal Plate'], rand);
    } },
  { id: 'pelt', anatomicalPart: 'Pelt', mode: 'equip', eligible: monsterHasFur, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/lion|tiger|cat/.test(t)) return pick(['Pelt', 'Fur', 'Striped Pelt', 'Soft Coat'], rand);
      if (/wolf|dog|fox/.test(t)) return pick(['Pelt', 'Fur', 'Thick Coat', 'Guard Hair'], rand);
      if (/bear/.test(t)) return pick(['Pelt', 'Bearskin', 'Dense Fur', 'Heavy Coat'], rand);
      if (/mane/.test(t)) return pick(['Mane', 'Pelt', 'Coarse Fur', 'Thick Mane'], rand);
      return pick(['Pelt', 'Fur', 'Thick Coat', 'Tuft of Fur'], rand);
    } },
  // -- Combine (raw crafting material — this rebuild's `material` itemType; the only mode this
  // module's buildMonsterPartMaterial actually consumes today) --
  { id: 'claw', anatomicalPart: 'Claw', mode: 'combine', eligible: () => true, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (monsterIsHumanoid(monster) && !monsterHasClaws(monster)) return pick(['Hand', 'Calloused Hand', 'Grasping Hand', 'Weathered Hand'], rand);
      if (monsterIsAquaticTentacled(monster)) return pick(['Grasping Tentacle', 'Suction-Cup Tentacle', 'Barbed Tentacle'], rand);
      if (/pincer|crab|lobster|scorpion/.test(t)) return pick(['Pincer', 'Crushing Pincer', 'Hooked Pincer'], rand);
      if (monsterIsBirdlike(monster)) return pick(['Clawed Foot', 'Hooked Claw', 'Raking Claw'], rand);
      if (/hoof|centaur|goat|ram|deer|horse/.test(t)) return pick(['Hoof', 'Split Hoof', 'Hard Hoof'], rand);
      return pick(['Claw', 'Hooked Claw', 'Raking Claw', 'Heavy Claw'], rand);
    } },
  { id: 'fang', anatomicalPart: 'Fang', mode: 'combine', eligible: monsterHasBite, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/tusk|elephant|mammoth|boar|orc/.test(t)) return pick(['Tusk', 'Curved Tusk', 'Heavy Tusk'], rand);
      if (/vampire|bat|wolf|werewolf|dire wolf/.test(t)) return pick(['Fang', 'Long Fang', 'Predator Fang'], rand);
      if (/snake|serpent|yuan-ti/.test(t)) return pick(['Hollow Fang', 'Venom Fang', 'Needle Fang'], rand);
      return pick(['Fang', 'Sharp Fang', 'Jagged Fang'], rand);
    } },
  { id: 'talon', anatomicalPart: 'Talon', mode: 'combine', eligible: m => monsterIsBirdlike(m) || getCreatureFamily(m).id === 'dragon' || /talon|raptor|bird|wyvern|claw foot/.test(monsterAnatomyText(m)), variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (monsterIsBirdlike(monster)) return pick(['Talon', 'Hooked Talon', 'Raptor Talon', 'Eagle Talon'], rand);
      if (/dragon|wyvern/.test(t)) return pick(['Dragon Talon', 'Hooked Talon', 'Raking Talon'], rand);
      return pick(['Talon', 'Hooked Talon', 'Raking Talon'], rand);
    } },
  { id: 'horn', anatomicalPart: 'Horn', mode: 'combine', eligible: monsterHasHorns, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/antler|deer|elk|stag/.test(t)) return pick(['Antler', 'Forked Antler', 'Crown Antler'], rand);
      if (/ram|goat|minotaur/.test(t)) return pick(['Ram Horn', 'Curved Horn', 'Spiral Horn'], rand);
      if (/tusk|elephant|mammoth|boar/.test(t)) return pick(['Tusk', 'Ivory Tusk', 'Heavy Tusk'], rand);
      return pick(['Horn', 'Curved Horn', 'Ridge Horn', 'Crown Horn'], rand);
    } },
  { id: 'bone', anatomicalPart: 'Bone', mode: 'combine', eligible: m => monsterIsOrganic(m) || monsterIsUndead(m), variants: (monster, rand) => {
      if (monsterIsUndead(monster)) return pick(['Bone', 'Rib Bone', 'Vertebra', 'Jawbone'], rand);
      return pick(['Bone', 'Rib Bone', 'Vertebra', 'Long Bone', 'Jawbone'], rand);
    } },
  { id: 'tendon', anatomicalPart: 'Tendon', mode: 'combine', eligible: monsterIsOrganic },
  { id: 'venomsac', anatomicalPart: 'Venom Sac', mode: 'combine', eligible: monsterHasVenom, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/spider|scorpion|insect/.test(t)) return pick(['Venom Sac', 'Poison Gland', 'Venom Bladder'], rand);
      return pick(['Venom Sac', 'Poison Gland', 'Toxic Sac', 'Venom Gland'], rand);
    } },
  { id: 'hide', anatomicalPart: 'Hide', mode: 'combine', eligible: monsterIsOrganic, variants: (monster, rand) => {
      if (monsterIsHumanoid(monster)) return pick(['Skin', 'Scalp', 'Hide', 'Calloused Skin'], rand);
      if (monsterHasScales(monster)) return pick(['Scaled Hide', 'Scale-Lined Hide', 'Thick Hide'], rand);
      if (monsterHasShell(monster)) return pick(['Armored Hide', 'Chitin-Lined Hide', 'Tough Hide'], rand);
      if (monsterIsUndead(monster)) return pick(['Dead Hide', 'Dried Hide', 'Necrotic Skin'], rand);
      return pick(['Hide', 'Thick Hide', 'Tough Hide', 'Weathered Hide'], rand);
    } },
  { id: 'blood', anatomicalPart: 'Blood', mode: 'combine', eligible: m => monsterIsOrganic(m) || monsterIsUndead(m) },
  { id: 'marrow', anatomicalPart: 'Marrow', mode: 'combine', eligible: m => monsterIsOrganic(m) || monsterIsUndead(m) },
  { id: 'wing', anatomicalPart: 'Wing', mode: 'combine', eligible: monsterHasWings, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/bat|vampire|devil|demon|dragon|wyvern/.test(t)) return pick(['Membranous Wing', 'Batlike Wing', 'Leathery Wing'], rand);
      if (monsterIsBirdlike(monster)) return pick(['Feathered Wing', 'Flight Wing', 'Broad Wing'], rand);
      if (/insect|beetle|fly|wasp|bee|dragonfly|pixie|fairy/.test(t)) return pick(['Insect Wing', 'Veined Wing', 'Delicate Wing'], rand);
      return pick(['Wing', 'Broad Wing', 'Powerful Wing'], rand);
    } },
  { id: 'tail', anatomicalPart: 'Tail', mode: 'combine', eligible: monsterHasTail, variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/scorpion|stinger|venom/.test(t)) return pick(['Stinger Tail', 'Barbed Tail', 'Venomous Tail'], rand);
      if (/dragon|wyvern/.test(t)) return pick(['Dragon Tail', 'Armored Tail', 'Spiked Tail'], rand);
      if (/snake|serpent|lizard/.test(t)) return pick(['Scaled Tail', 'Whiplike Tail', 'Prehensile Tail'], rand);
      return pick(['Tail', 'Whiplike Tail', 'Prehensile Tail', 'Tufted Tail'], rand);
    } },
  { id: 'tongue', anatomicalPart: 'Tongue', mode: 'combine', eligible: m => monsterIsOrganic(m) || monsterIsUndead(m), variants: (monster, rand) => {
      const t = monsterAnatomyText(monster);
      if (/snake|serpent|lizard|yuan-ti/.test(t)) return pick(['Forked Tongue', 'Scaled Tongue', 'Serpent Tongue'], rand);
      if (/frog|toad|bullywug/.test(t)) return pick(['Long Tongue', 'Sticky Tongue', 'Frog Tongue'], rand);
      if (/tentacle|kraken|aberration/.test(t)) return pick(['Sensory Tongue', 'Barbed Tongue', 'Prehensile Tongue'], rand);
      return pick(['Tongue', 'Long Tongue', 'Rough Tongue'], rand);
    } },
];

// What a combine-mode part is actually good for once something can process it — reagent (potions/
// alchemy) vs. weapon_material/armor_material (crafting/smithing inputs). The old app didn't tag
// combine-mode parts this way itself (that tagging lived in an older, already-superseded flat
// list) — this extends that same real tagging scheme to the 5 combine ids new to the v2 list
// (tendon, blood, marrow, wing, tail) using the same judgment (a claw is both a weapon material and
// a reagent; a wing reads as armor-material lining; blood/marrow/tongue are alchemical reagents).
const COMBINE_PART_MATERIAL_TAGS = {
  claw: ['weapon_material', 'reagent'],
  fang: ['weapon_material', 'reagent'],
  talon: ['weapon_material'],
  horn: ['weapon_material', 'armor_material'],
  bone: ['weapon_material', 'armor_material'],
  tendon: ['weapon_material'],
  venomsac: ['reagent'],
  hide: ['armor_material'],
  blood: ['reagent'],
  marrow: ['reagent'],
  wing: ['armor_material'],
  tail: ['weapon_material'],
  tongue: ['reagent'],
};

// Kept ported for the future wondrous item type — not called by buildMonsterPartMaterial.
export function describeEquipEffect(theme, tier) {
  const magnitude = PART_RARITY_MAGNITUDE[tier] || 1;
  if (theme.equip.ac) return `+${magnitude} AC.`;
  const amount = magnitude * (theme.equip.mult || 1);
  return `+${amount} ${theme.equip.stat}.`;
}

export function getEligibleCombineParts(monster) {
  return MONSTER_PARTS.filter(p => {
    if (p.mode !== 'combine') return false;
    try { return p.eligible(monster); } catch { return false; }
  });
}

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

/**
 * Builds a real `material` Item (this rebuild's schema) from a monster + rarity tier + a
 * combine-mode MONSTER_PARTS entry. No CR-band tier lookup (the old app's monsterRarityTier) —
 * this rebuild has no monster/NPC records with CR yet, so the caller passes the tier directly,
 * same resolution used for the Phase 3 demo combat and Phase 5 demo-target consumable work.
 */
export function buildMonsterPartMaterial(monster, tier, partDef, rand = Math.random) {
  if (partDef.mode !== 'combine') {
    throw new Error(`buildMonsterPartMaterial only builds combine-mode parts (got mode "${partDef.mode}" for "${partDef.id}") — equip-mode parts belong to the future wondrous item type`);
  }
  const family = getCreatureFamily(monster);
  const subtype = getCreatureSubtype(monster, family);
  const theme = PART_THEMES[(subtype && subtype.theme) || family.baseTheme] || PART_THEMES.primal_strength;
  const themeLabel = subtype ? subtype.label : family.label;
  let partLabel = partDef.anatomicalPart;
  if (partDef.variants) { try { partLabel = partDef.variants(monster, rand) || partLabel; } catch { /* keep flat label */ } }
  const name = `${themeLabel} ${partLabel}`;
  const [wLo, wHi] = MONSTER_PART_WEIGHT_RANGE[tier] || MONSTER_PART_WEIGHT_RANGE.common;
  const weight = Math.round((wLo + rand() * (wHi - wLo)) * 10) / 10;
  const [gLo, gHi] = MONSTER_PART_GP_RANGE[tier] || MONSTER_PART_GP_RANGE.common;
  const gp = Math.floor(gLo + rand() * (gHi - gLo + 1));
  const flavorText = `A ${partLabel.toLowerCase()} taken from a ${themeLabel.toLowerCase()}, radiating ${theme.flavor}.`;
  return {
    id: `monster-part-${slugify(monster.name)}-${partDef.id}`,
    name, itemType: 'material', rarity: tier, value: `${gp} gp`, weight,
    flavorText,
    material: { materialTags: COMBINE_PART_MATERIAL_TAGS[partDef.id] || ['reagent'] },
  };
}

export function generateMonsterPartMaterial(monster, tier, rand = Math.random) {
  const eligible = getEligibleCombineParts(monster);
  const pool = eligible.length ? eligible : MONSTER_PARTS.filter(p => p.mode === 'combine');
  const partDef = pick(pool, rand);
  return buildMonsterPartMaterial(monster, tier, partDef, rand);
}
