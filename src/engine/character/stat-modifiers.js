// A generic StatModifier aggregator — the same {stat, value} shape traits use (Phase 2, confirmed
// structured-with-real-effects) and weapon/armor items' `passive` facet now reuses too (Phase 4),
// so this lives in its own module rather than being duplicated per consumer.
//
// Supported `stat` values: 'ac', 'hp_max', 'speed', an ability abbreviation ('str'|'dex'|'con'|
// 'int'|'wis'|'cha' — bumps that ability's MODIFIER, not the raw score, so it doesn't
// retroactively change proficiency-bonus math), an exact skill name from SKILL_ABILITY_MAP (e.g.
// 'Stealth'), `save_<abbr>` (e.g. 'save_dex'), or 'attackRoll'/'damageRoll' (added in Phase 4 —
// the "+1 weapon" case: a flat bonus to attack/damage rolls, consumed by
// src/engine/combat/attack.js's getAttackBonus/getDamageBonus once item equip lands in Phase 6).
// Unrecognized stat values are simply never summed by anything — each consumer only asks for the
// keys it knows about — so an unsupported value doesn't error, it just has no effect yet.

export function collectStatMods(traits = []) {
  return traits.flatMap(t => t.statMods || []);
}

export function sumModifier(statMods, stat) {
  return statMods.filter(m => m.stat === stat).reduce((sum, m) => sum + m.value, 0);
}
