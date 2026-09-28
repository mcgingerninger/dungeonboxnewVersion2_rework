// Vanilla-DOM character sheet: create/edit a character, with every derived value (ability
// modifiers, proficiency bonus, max HP, AC, skill/save bonuses) recomputed live via
// computeDerivedSheet as the player edits raw fields. No framework — same manual-DOM-update style
// as the rest of this rebuild, but the static form structure is built ONCE on mount and only the
// read-only computed spans are touched on every keystroke (direct textContent writes), rather
// than re-rendering the whole form on every input — re-rendering the whole thing on every
// keystroke would steal focus out of whatever input the player is mid-typing in. Traits (add/
// remove is a discrete click, not a per-keystroke event) re-render their own sub-section only.

import { ABILITY_NAMES, SKILL_ABILITY_MAP } from '../../engine/character/ability-scores.js';
import { computeDerivedSheet } from '../../engine/character/character-sheet.js';

const HIT_DIE_SIZES = [6, 8, 10, 12];
const ABILITY_ABBRS = Object.keys(ABILITY_NAMES);
const SKILL_NAMES = Object.keys(SKILL_ABILITY_MAP);
const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const CREATURE_SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
// The 9 standard D&D alignments, law/chaos axis outer to inner then good/evil — '' is an
// explicit "unset" choice (a blank first <option>), not defaulted to a real alignment, since
// "no alignment chosen yet" and "True Neutral" are meaningfully different starting states.
const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil',
];

function statModOptionsHtml() {
  const abilityOpts = ABILITY_ABBRS.map(a => `<option value="${a}">${ABILITY_NAMES[a]} modifier</option>`).join('');
  const skillOpts = SKILL_NAMES.map(s => `<option value="${s}">${s}</option>`).join('');
  const saveOpts = ABILITY_ABBRS.map(a => `<option value="save_${a}">${ABILITY_NAMES[a]} save</option>`).join('');
  return `
    <option value="ac">Armor Class</option>
    <option value="hp_max">Max HP</option>
    <option value="speed">Speed</option>
    <optgroup label="Ability modifiers">${abilityOpts}</optgroup>
    <optgroup label="Skills">${skillOpts}</optgroup>
    <optgroup label="Saving throws">${saveOpts}</optgroup>
  `;
}

function blankCharacter() {
  return {
    username: '', class: '', level: 1, hitDieSize: 8, proficiencyBonus: 2,
    speed: 30, size: 'Medium', alignment: '',
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    currentHp: 0,
    skillProficiencies: [], skillExpertise: [], saveProficiencies: [],
    spellSlotsMax: {}, spellSlotsUsed: {},
    traits: [],
  };
}

export function mountCharacterSheet(container, campaignId, accountUidParam) {
  let character = blankCharacter();
  let loaded = false;

  async function load() {
    const res = await fetch(`/campaigns/${campaignId}/characters/${accountUidParam}`);
    if (res.status === 404) { loaded = true; renderAll(); return; }
    if (!res.ok) throw new Error(`GET character failed: ${res.status}`);
    const sheet = await res.json();
    character = {
      username: sheet.username || '', class: sheet.class || '',
      level: sheet.level || 1, hitDieSize: sheet.hitDieSize || 8,
      proficiencyBonus: sheet.proficiencyBonus ?? 2,
      speed: sheet.speed ?? 30, size: sheet.size || 'Medium', alignment: sheet.alignment || '',
      abilityScores: sheet.abilityScores || blankCharacter().abilityScores,
      currentHp: sheet.currentHp || 0,
      skillProficiencies: sheet.skillProficiencies || [],
      skillExpertise: sheet.skillExpertise || [],
      saveProficiencies: sheet.saveProficiencies || [],
      spellSlotsMax: sheet.spellSlotsMax || {}, spellSlotsUsed: sheet.spellSlotsUsed || {},
      traits: sheet.traits || [],
    };
    loaded = true;
    renderAll();
  }

  async function save() {
    const derived = computeDerivedSheet(character);
    const statusEl = container.querySelector('#cs-status');
    statusEl.textContent = 'Saving…';
    try {
      const res = await fetch(`/campaigns/${campaignId}/characters/${accountUidParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...character, maxHp: derived.maxHp, maxHpEffective: derived.maxHp, ac: derived.ac }),
      });
      if (!res.ok) throw new Error(`PUT character failed: ${res.status}`);
      statusEl.textContent = `Saved.`;
    } catch (err) {
      statusEl.textContent = `Error saving: ${err.message}`;
    }
  }

  function updateComputedDisplay() {
    const d = computeDerivedSheet(character);
    for (const a of ABILITY_ABBRS) {
      const el = container.querySelector(`#mod-${a}`);
      if (el) el.textContent = fmtMod(d.abilityModifiers[a]);
    }
    // Proficiency Bonus is now a directly editable input (see the confirmed "adjustable field"
    // change), not a computed read-only span — it holds its own value and isn't touched here.
    const hpEl = container.querySelector('#cs-max-hp');
    if (hpEl) hpEl.textContent = d.maxHp;
    const acEl = container.querySelector('#cs-ac');
    if (acEl) acEl.textContent = d.ac;
    const speedEl = container.querySelector('#cs-effective-speed');
    if (speedEl) speedEl.textContent = `${d.effectiveSpeed} ft`;
    for (const skill of SKILL_NAMES) {
      const el = container.querySelector(`#skill-bonus-${cssSafe(skill)}`);
      if (el) el.textContent = fmtMod(d.skillBonuses[skill]);
    }
    for (const a of ABILITY_ABBRS) {
      const el = container.querySelector(`#save-bonus-${a}`);
      if (el) el.textContent = fmtMod(d.saveBonuses[a]);
    }
    return d;
  }

  function fmtMod(n) { return (n >= 0 ? '+' : '') + n; }
  function cssSafe(s) { return s.replace(/\s+/g, '-'); }

  function traitsHtml() {
    if (!character.traits.length) return '<p class="cs-empty">No traits yet.</p>';
    return character.traits.map((t, i) => `
      <div class="cs-trait" data-trait-index="${i}">
        <input type="text" class="trait-name" placeholder="Trait name" value="${escapeAttr(t.name || '')}">
        <input type="text" class="trait-desc" placeholder="Description" value="${escapeAttr(t.description || '')}">
        <div class="cs-trait-mods">
          ${(t.statMods || []).map((m, mi) => `
            <span class="cs-trait-mod" data-mod-index="${mi}">
              <select class="trait-mod-stat">${statModOptionsHtml()}</select>
              <input type="number" class="trait-mod-value" value="${m.value}" style="width:3.5em;">
              <button type="button" class="trait-mod-remove">✕</button>
            </span>
          `).join('')}
        </div>
        <button type="button" class="trait-mod-add">+ Stat modifier</button>
        <button type="button" class="trait-remove">✕ Remove trait</button>
      </div>
    `).join('');
  }

  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function renderTraits() {
    const wrap = container.querySelector('#cs-traits-list');
    wrap.innerHTML = traitsHtml();
    // Set each trait-mod-stat <select>'s value AFTER insertion — setting `selected` in the HTML
    // string above would need per-option string surgery; assigning .value post-insert is simpler
    // and exactly as reliable for a <select>.
    character.traits.forEach((t, i) => {
      (t.statMods || []).forEach((m, mi) => {
        const sel = wrap.querySelector(`[data-trait-index="${i}"] [data-mod-index="${mi}"] .trait-mod-stat`);
        if (sel) sel.value = m.stat;
      });
    });
  }

  function renderAll() {
    if (!loaded) { container.innerHTML = '<p>Loading character…</p>'; return; }
    container.innerHTML = `
      <div class="character-sheet">
        <h2>Character Sheet</h2>
        <div class="cs-row">
          <label>Name <input id="cs-username" type="text" value="${escapeAttr(character.username)}"></label>
          <label>Class (flavor) <input id="cs-class" type="text" value="${escapeAttr(character.class)}"></label>
          <label>Level <input id="cs-level" type="number" min="1" max="20" value="${character.level}"></label>
          <label>Hit Die
            <select id="cs-hitdie">
              ${HIT_DIE_SIZES.map(s => `<option value="${s}" ${s === character.hitDieSize ? 'selected' : ''}>d${s}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="cs-row">
          <label>Size
            <select id="cs-size">
              ${CREATURE_SIZES.map(s => `<option value="${s}" ${s === character.size ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <label>Alignment
            <select id="cs-alignment">
              <option value="" ${character.alignment === '' ? 'selected' : ''}>—</option>
              ${ALIGNMENTS.map(a => `<option value="${a}" ${a === character.alignment ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </label>
          <label>Speed (ft) <input id="cs-speed" type="number" min="0" value="${character.speed}"></label>
        </div>

        <h3>Ability Scores</h3>
        <div class="cs-row cs-abilities">
          ${ABILITY_ABBRS.map(a => `
            <label class="cs-ability">${ABILITY_NAMES[a]}
              <input class="ability-score" data-ability="${a}" type="number" min="1" max="30" value="${character.abilityScores[a]}">
              <span id="mod-${a}" class="cs-computed"></span>
            </label>
          `).join('')}
        </div>

        <h3>Vitals</h3>
        <div class="cs-row">
          <label>Proficiency Bonus (adjustable) <input id="cs-prof-bonus" type="number" value="${character.proficiencyBonus}"></label>
          <span>Max HP (derived): <strong id="cs-max-hp"></strong></span>
          <label>Current HP <input id="cs-current-hp" type="number" value="${character.currentHp}"></label>
          <span>AC (derived, 10 + Dex, no armor yet): <strong id="cs-ac"></strong></span>
          <span>Speed (effective): <strong id="cs-effective-speed"></strong></span>
        </div>

        <h3>Skills</h3>
        <table class="cs-skills">
          <thead><tr><th>Skill</th><th>Prof.</th><th>Expertise</th><th>Bonus</th></tr></thead>
          <tbody>
            ${SKILL_NAMES.map(skill => `
              <tr>
                <td>${skill} <span class="cs-dim">(${ABILITY_NAMES[SKILL_ABILITY_MAP[skill]]})</span></td>
                <td><input type="checkbox" class="skill-prof" data-skill="${skill}" ${character.skillProficiencies.includes(skill) ? 'checked' : ''}></td>
                <td><input type="checkbox" class="skill-expertise" data-skill="${skill}" ${character.skillExpertise.includes(skill) ? 'checked' : ''}></td>
                <td id="skill-bonus-${cssSafe(skill)}" class="cs-computed"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h3>Saving Throws</h3>
        <table class="cs-saves">
          <thead><tr><th>Ability</th><th>Prof.</th><th>Bonus</th></tr></thead>
          <tbody>
            ${ABILITY_ABBRS.map(a => `
              <tr>
                <td>${ABILITY_NAMES[a]}</td>
                <td><input type="checkbox" class="save-prof" data-ability="${a}" ${character.saveProficiencies.includes(a) ? 'checked' : ''}></td>
                <td id="save-bonus-${a}" class="cs-computed"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h3>Spell Slots</h3>
        <div class="cs-row cs-spell-slots">
          ${SPELL_LEVELS.map(lvl => `
            <label class="cs-slot">Lvl ${lvl}
              <input type="number" min="0" class="slot-max" data-level="${lvl}" value="${character.spellSlotsMax[lvl] || 0}" title="Max slots">
              /
              <input type="number" min="0" class="slot-used" data-level="${lvl}" value="${character.spellSlotsUsed[lvl] || 0}" title="Used">
            </label>
          `).join('')}
        </div>

        <h3>Traits</h3>
        <div id="cs-traits-list"></div>
        <button type="button" id="cs-add-trait">+ Add trait</button>

        <div class="cs-save-row">
          <button type="button" id="cs-save">Save Character</button>
          <span id="cs-status"></span>
        </div>
      </div>
    `;
    renderTraits();
    attachListeners();
    updateComputedDisplay();
  }

  function attachListeners() {
    container.querySelector('#cs-username').addEventListener('input', e => { character.username = e.target.value; });
    container.querySelector('#cs-class').addEventListener('input', e => { character.class = e.target.value; });
    container.querySelector('#cs-level').addEventListener('input', e => {
      character.level = Math.max(1, Math.min(20, Number(e.target.value) || 1));
      updateComputedDisplay();
    });
    container.querySelector('#cs-hitdie').addEventListener('change', e => {
      character.hitDieSize = Number(e.target.value);
      updateComputedDisplay();
    });
    container.querySelector('#cs-current-hp').addEventListener('input', e => { character.currentHp = Number(e.target.value) || 0; });
    container.querySelector('#cs-size').addEventListener('change', e => { character.size = e.target.value; });
    container.querySelector('#cs-alignment').addEventListener('change', e => { character.alignment = e.target.value; });
    container.querySelector('#cs-speed').addEventListener('input', e => {
      character.speed = Number(e.target.value) || 0;
      updateComputedDisplay();
    });
    container.querySelector('#cs-prof-bonus').addEventListener('input', e => {
      character.proficiencyBonus = Number(e.target.value) || 0;
      updateComputedDisplay();
    });

    container.querySelectorAll('.ability-score').forEach(input => {
      input.addEventListener('input', e => {
        character.abilityScores[e.target.dataset.ability] = Number(e.target.value) || 0;
        updateComputedDisplay();
      });
    });

    container.querySelectorAll('.skill-prof').forEach(cb => {
      cb.addEventListener('change', e => {
        const skill = e.target.dataset.skill;
        toggleInArray(character.skillProficiencies, skill, e.target.checked);
        updateComputedDisplay();
      });
    });
    container.querySelectorAll('.skill-expertise').forEach(cb => {
      cb.addEventListener('change', e => {
        const skill = e.target.dataset.skill;
        toggleInArray(character.skillExpertise, skill, e.target.checked);
        updateComputedDisplay();
      });
    });
    container.querySelectorAll('.save-prof').forEach(cb => {
      cb.addEventListener('change', e => {
        toggleInArray(character.saveProficiencies, e.target.dataset.ability, e.target.checked);
        updateComputedDisplay();
      });
    });

    container.querySelectorAll('.slot-max').forEach(input => {
      input.addEventListener('input', e => { character.spellSlotsMax[e.target.dataset.level] = Number(e.target.value) || 0; });
    });
    container.querySelectorAll('.slot-used').forEach(input => {
      input.addEventListener('input', e => { character.spellSlotsUsed[e.target.dataset.level] = Number(e.target.value) || 0; });
    });

    container.querySelector('#cs-add-trait').addEventListener('click', () => {
      character.traits.push({ id: `trait-${Date.now()}`, name: '', description: '', statMods: [] });
      renderTraits();
      attachTraitListeners();
    });
    attachTraitListeners();

    container.querySelector('#cs-save').addEventListener('click', save);
  }

  function toggleInArray(arr, value, shouldInclude) {
    const i = arr.indexOf(value);
    if (shouldInclude && i === -1) arr.push(value);
    else if (!shouldInclude && i !== -1) arr.splice(i, 1);
  }

  function attachTraitListeners() {
    const wrap = container.querySelector('#cs-traits-list');
    wrap.querySelectorAll('.cs-trait').forEach(traitEl => {
      const i = Number(traitEl.dataset.traitIndex);
      traitEl.querySelector('.trait-name').addEventListener('input', e => { character.traits[i].name = e.target.value; });
      traitEl.querySelector('.trait-desc').addEventListener('input', e => { character.traits[i].description = e.target.value; });
      traitEl.querySelector('.trait-remove').addEventListener('click', () => {
        character.traits.splice(i, 1);
        renderTraits();
        attachTraitListeners();
        updateComputedDisplay();
      });
      traitEl.querySelector('.trait-mod-add').addEventListener('click', () => {
        if (!character.traits[i].statMods) character.traits[i].statMods = [];
        character.traits[i].statMods.push({ stat: 'ac', value: 1 });
        renderTraits();
        attachTraitListeners();
        updateComputedDisplay();
      });
      traitEl.querySelectorAll('.cs-trait-mod').forEach(modEl => {
        const mi = Number(modEl.dataset.modIndex);
        modEl.querySelector('.trait-mod-stat').addEventListener('change', e => {
          character.traits[i].statMods[mi].stat = e.target.value;
          updateComputedDisplay();
        });
        modEl.querySelector('.trait-mod-value').addEventListener('input', e => {
          character.traits[i].statMods[mi].value = Number(e.target.value) || 0;
          updateComputedDisplay();
        });
        modEl.querySelector('.trait-mod-remove').addEventListener('click', () => {
          character.traits[i].statMods.splice(mi, 1);
          renderTraits();
          attachTraitListeners();
          updateComputedDisplay();
        });
      });
    });
  }

  load().catch(err => { container.innerHTML = `<p>Error loading character: ${err.message}</p>`; });
}
