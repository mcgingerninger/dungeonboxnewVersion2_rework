import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectStatMods, sumModifier } from './stat-modifiers.js';

describe('collectStatMods', () => {
  test('flattens statMods across every trait', () => {
    const traits = [
      { statMods: [{ stat: 'ac', value: 1 }] },
      { statMods: [{ stat: 'hp_max', value: 5 }, { stat: 'ac', value: 1 }] },
    ];
    assert.deepEqual(collectStatMods(traits), [
      { stat: 'ac', value: 1 }, { stat: 'hp_max', value: 5 }, { stat: 'ac', value: 1 },
    ]);
  });

  test('traits with no statMods field contribute nothing, no error', () => {
    assert.deepEqual(collectStatMods([{ name: 'Flavor only' }]), []);
  });

  test('empty/missing traits list returns an empty array', () => {
    assert.deepEqual(collectStatMods([]), []);
    assert.deepEqual(collectStatMods(), []);
  });
});

describe('sumModifier', () => {
  test('sums only the entries matching the requested stat', () => {
    const mods = [{ stat: 'ac', value: 1 }, { stat: 'hp_max', value: 5 }, { stat: 'ac', value: 2 }];
    assert.equal(sumModifier(mods, 'ac'), 3);
    assert.equal(sumModifier(mods, 'hp_max'), 5);
  });

  test('returns 0 when nothing matches', () => {
    assert.equal(sumModifier([{ stat: 'ac', value: 1 }], 'hp_max'), 0);
    assert.equal(sumModifier([], 'ac'), 0);
  });

  test('sums a skill-targeted modifier by exact skill name', () => {
    const mods = [{ stat: 'Stealth', value: 2 }, { stat: 'save_dex', value: 1 }];
    assert.equal(sumModifier(mods, 'Stealth'), 2);
    assert.equal(sumModifier(mods, 'save_dex'), 1);
    assert.equal(sumModifier(mods, 'save_str'), 0);
  });
});
