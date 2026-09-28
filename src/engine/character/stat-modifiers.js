// A generic StatModifier aggregator — the same {stat, value} shape traits use now (Section
// "traits" in the rebuild plan, confirmed as structured-with-real-effects) and items' passive
// effects are planned to reuse later (Phase 4-6), so this lives in its own module rather than
// being duplicated once items exist.
//
// Supported `stat` values today (only what Phase 2 actually models): 'ac', 'hp_max', an ability
// abbreviation ('str'|'dex'|'con'|'int'|'wis'|'cha' — bumps that ability's MODIFIER, not the raw
// score, so it doesn't retroactively change proficiency-bonus math), an exact skill name from
// SKILL_ABILITY_MAP (e.g. 'Stealth'), or `save_<abbr>` (e.g. 'save_dex'). Unrecognized stat
// values are simply never summed by anything — computeDerivedSheet only asks for the keys it
// knows about — so an unsupported value doesn't error, it just has no effect yet.

export function collectStatMods(traits = []) {
  return traits.flatMap(t => t.statMods || []);
}

export function sumModifier(statMods, stat) {
  return statMods.filter(m => m.stat === stat).reduce((sum, m) => sum + m.value, 0);
}
