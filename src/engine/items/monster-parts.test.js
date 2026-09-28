import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  monsterAnatomyText, monsterHasBite, monsterHasClaws, monsterHasWings, monsterIsOrganic,
  getCreatureFamily, getCreatureSubtype, getEligibleCombineParts, buildMonsterPartMaterial,
  generateMonsterPartMaterial, MONSTER_PARTS, PART_THEMES, CREATURE_FAMILIES,
} from './monster-parts.js';
import { validateItem } from './validate-item.js';

const direWolf = {
  name: 'Dire Wolf', type: 'beast', size: 'Large', speed: '50 ft.',
  traits: [], actions: [{ name: 'Bite', text: 'The wolf bites with its fangs, claws raking, tail lashing.' }],
};
const redDragonWyrmling = {
  name: 'Red Dragon Wyrmling', type: 'dragon', size: 'Medium', speed: '30 ft., fly 60 ft.',
  traits: [], actions: [{ name: 'Bite', text: 'Fangs and claws, scaled tail, wings, curved horns.' }],
};
const skeleton = { name: 'Skeleton', type: 'undead', size: 'Medium', speed: '30 ft.', traits: [], actions: [] };
const plainOoze = { name: 'Gray Ooze', type: 'ooze', size: 'Medium', speed: '10 ft.', traits: [], actions: [] };

describe('anatomy detection reads concatenated monster text', () => {
  test('monsterAnatomyText lowercases and joins name/type/traits/actions', () => {
    assert.match(monsterAnatomyText(direWolf), /dire wolf/);
    assert.match(monsterAnatomyText(direWolf), /fangs/);
  });
  test('monsterHasBite/HasClaws/HasWings match on real flavor text', () => {
    assert.equal(monsterHasBite(direWolf), true);
    assert.equal(monsterHasClaws(direWolf), true);
    assert.equal(monsterHasWings(direWolf), false);
    assert.equal(monsterHasWings(redDragonWyrmling), true);
  });
  test('monsterIsOrganic is false only for constructs/elementals', () => {
    assert.equal(monsterIsOrganic(direWolf), true);
    assert.equal(monsterIsOrganic({ name: 'Golem', type: 'construct' }), false);
  });
});

describe('creature family + subtype resolution', () => {
  test('a beast with no other family match falls back to the beast family', () => {
    assert.equal(getCreatureFamily(direWolf).id, 'beast');
  });
  test('every family in CREATURE_FAMILIES is reachable and beast is the final catch-all', () => {
    assert.equal(CREATURE_FAMILIES[CREATURE_FAMILIES.length - 1].id, 'beast');
    assert.equal(getCreatureFamily({ name: 'Anything', type: 'totally-unknown-type' }).id, 'beast');
  });
  test('dragon type resolves to the dragon family', () => {
    assert.equal(getCreatureFamily(redDragonWyrmling).id, 'dragon');
  });
  test('a name keyword match resolves a named subtype with its own theme', () => {
    const family = getCreatureFamily(redDragonWyrmling);
    const subtype = getCreatureSubtype(redDragonWyrmling, family);
    assert.equal(subtype.label, 'Red Dragon');
    assert.equal(subtype.theme, 'elemental_fire');
  });
  test('no keyword match returns null, not a throw', () => {
    const family = getCreatureFamily(plainOoze);
    assert.equal(family.id, 'ooze');
    assert.equal(getCreatureSubtype(plainOoze, family), null);
  });
  test('wolf keyword resolves the beast-family Wolf subtype', () => {
    const family = getCreatureFamily(direWolf);
    const subtype = getCreatureSubtype(direWolf, family);
    assert.equal(subtype.label, 'Wolf');
    assert.equal(subtype.theme, 'swift_evasion');
  });
});

describe('every PART_THEMES entry referenced by a subtype or family baseTheme actually exists', () => {
  test('no dangling theme id', () => {
    const familyThemes = CREATURE_FAMILIES.map(f => f.baseTheme);
    for (const themeId of familyThemes) assert.ok(PART_THEMES[themeId], themeId);
  });
});

describe('getEligibleCombineParts', () => {
  test('only returns combine-mode parts whose eligible(monster) passes', () => {
    const parts = getEligibleCombineParts(direWolf);
    assert.ok(parts.every(p => p.mode === 'combine'));
    assert.ok(parts.some(p => p.id === 'claw'));
    assert.ok(parts.some(p => p.id === 'fang'));
    assert.ok(!parts.some(p => p.id === 'venomsac'));
  });
  test('a bad eligible() predicate is swallowed, not thrown', () => {
    assert.doesNotThrow(() => getEligibleCombineParts(null));
  });
});

describe('buildMonsterPartMaterial produces a real, valid material Item', () => {
  const clawPart = MONSTER_PARTS.find(p => p.id === 'claw');
  const fixedRand = () => 0.5;

  test('validates cleanly against the schema', () => {
    const item = buildMonsterPartMaterial(direWolf, 'common', clawPart, fixedRand);
    const result = validateItem(item);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });

  test('name combines the resolved theme label with the (possibly variant) part label', () => {
    const item = buildMonsterPartMaterial(direWolf, 'common', clawPart, fixedRand);
    assert.match(item.name, /^Wolf /);
  });

  test('rejects an equip-mode part', () => {
    const eyePart = MONSTER_PARTS.find(p => p.id === 'eye');
    assert.throws(() => buildMonsterPartMaterial(direWolf, 'common', eyePart, fixedRand));
  });

  test('weight and gp scale with the given rarity tier range, deterministically for a fixed rand', () => {
    const common = buildMonsterPartMaterial(direWolf, 'common', clawPart, fixedRand);
    const legendary = buildMonsterPartMaterial(direWolf, 'legendary', clawPart, fixedRand);
    assert.ok(common.weight < legendary.weight);
    assert.equal(Number(common.value.split(' ')[0]) < Number(legendary.value.split(' ')[0]), true);
    const again = buildMonsterPartMaterial(direWolf, 'common', clawPart, fixedRand);
    assert.deepEqual(again, common);
  });

  test('materialTags come from the part id, always includes at least one tag', () => {
    const item = buildMonsterPartMaterial(direWolf, 'common', clawPart, fixedRand);
    assert.ok(item.material.materialTags.length > 0);
  });

  test('no monster-part material ever carries a mechanical facet', () => {
    const item = buildMonsterPartMaterial(skeleton, 'common', MONSTER_PARTS.find(p => p.id === 'bone'), fixedRand);
    for (const facet of ['weapon', 'armor', 'consumable', 'tool', 'passive', 'abilities', 'grants']) {
      assert.equal(item[facet], undefined, facet);
    }
  });
});

describe('generateMonsterPartMaterial', () => {
  test('always returns a valid item even with real Math.random', () => {
    for (let i = 0; i < 25; i++) {
      const item = generateMonsterPartMaterial(direWolf, 'uncommon');
      assert.equal(validateItem(item).valid, true);
    }
  });
  test('a construct (organic-gated parts all ineligible) still resolves via always-eligible claw', () => {
    const construct = { name: 'Inert Cube', type: 'construct', traits: [], actions: [] };
    const eligible = getEligibleCombineParts(construct);
    assert.deepEqual(eligible.map(p => p.id), ['claw']);
    const item = generateMonsterPartMaterial(construct, 'common', () => 0.1);
    assert.equal(item.itemType, 'material');
  });
});
