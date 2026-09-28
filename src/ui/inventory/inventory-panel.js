// Phase 6 of the mechanics rebuild: the real inventory/equip UI, replacing items-panel.js's
// demo-target pattern with the actual persisted character (same campaignId/accountUid identity
// character-sheet.js already uses) — equip/unequip actually changes AC live off real armor data,
// Use actually heals/damages the real character and persists usesLeft, and any item with an
// abilities[] facet can be Activated with real charge tracking, all via
// src/engine/character/equipment.js + src/engine/items/{consume,abilities}.js.

import { resolveItem, allItems } from '../../data/catalog.js';
import {
  EQUIPMENT_SLOTS, equipmentSlotsForItem, equipItem, unequipSlot, computeDerivedSheetWithEquipment,
} from '../../engine/character/equipment.js';
import { useConsumable } from '../../engine/items/consume.js';
import { activateAbility } from '../../engine/items/abilities.js';

let instanceCounter = 0;

function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

export function mountInventoryPanel(container, campaignId, accountUidParam) {
  let character = null;
  let loaded = false;
  let statusText = '';

  async function load() {
    const res = await fetch(`/campaigns/${campaignId}/characters/${accountUidParam}`);
    if (res.status === 404) {
      // No character yet — create a minimal one so there's something to equip against, same
      // "self-contained, don't block on other tabs" approach combat-panel.js already uses.
      const created = await fetch(`/campaigns/${campaignId}/characters/${accountUidParam}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Inventory Test PC', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, currentHp: 10, maxHp: 10, maxHpEffective: 10 }),
      });
      character = await created.json();
    } else {
      if (!res.ok) throw new Error(`GET character failed: ${res.status}`);
      character = await res.json();
    }
    character.inventory = character.inventory || [];
    character.equippedSlots = character.equippedSlots || {};
    loaded = true;
    render();
  }

  async function persist(partial) {
    statusText = 'Saving…';
    render();
    const res = await fetch(`/campaigns/${campaignId}/characters/${accountUidParam}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...character, ...partial }),
    });
    if (!res.ok) { statusText = `Error saving: ${res.status}`; render(); return; }
    character = { ...character, ...partial };
    statusText = 'Saved.';
    render();
  }

  function derived() {
    return computeDerivedSheetWithEquipment(character, character.equippedSlots, character.inventory, resolveItem);
  }

  function addItemToInventory(itemId) {
    const entry = { instanceId: `inst-${Date.now()}-${++instanceCounter}`, itemId };
    const item = resolveItem(itemId);
    if (item?.itemType === 'consumable') entry.usesLeft = item.consumable.usesLeft ?? item.consumable.uses.max;
    persist({ inventory: [...character.inventory, entry] });
  }

  function doEquip(instanceId, slotId) {
    try {
      const next = equipItem(character.equippedSlots, character.inventory, instanceId, slotId, resolveItem);
      const ac = computeDerivedSheetWithEquipment(character, next, character.inventory, resolveItem).ac;
      persist({ equippedSlots: next, ac });
    } catch (err) {
      statusText = `Error: ${err.message}`;
      render();
    }
  }

  function doUnequip(slotId) {
    const next = unequipSlot(character.equippedSlots, slotId);
    const ac = computeDerivedSheetWithEquipment(character, next, character.inventory, resolveItem).ac;
    persist({ equippedSlots: next, ac });
  }

  function doUseConsumable(instanceId, effectIndex) {
    const entry = character.inventory.find(e => e.instanceId === instanceId);
    const item = resolveItem(entry.itemId);
    const liveItem = { ...item, consumable: { ...item.consumable, usesLeft: entry.usesLeft ?? item.consumable.usesLeft } };
    const { result, usesLeft } = useConsumable(liveItem, effectIndex, { currentHp: character.currentHp, maxHp: character.maxHpEffective ?? character.maxHp }, Math.random);
    const inventory = character.inventory.map(e => e.instanceId === instanceId ? { ...e, usesLeft } : e);
    const patch = { inventory };
    if (result.kind === 'heal' || result.kind === 'damage') patch.currentHp = result.newCurrentHp;
    statusText = describeResult(item.name, result);
    persist(patch);
  }

  function doActivateAbility(instanceId, abilityIndex) {
    const entry = character.inventory.find(e => e.instanceId === instanceId);
    const item = resolveItem(entry.itemId);
    const abilityUses = (entry.abilityUsesLeft || {})[abilityIndex];
    const liveItem = {
      ...item,
      abilities: item.abilities.map((a, i) => i === abilityIndex ? { ...a, usesLeft: abilityUses ?? a.usesLeft } : a),
    };
    const { result, usesLeft } = activateAbility(liveItem, abilityIndex, { currentHp: character.currentHp, maxHp: character.maxHpEffective ?? character.maxHp }, Math.random);
    const inventory = character.inventory.map(e => e.instanceId === instanceId
      ? { ...e, abilityUsesLeft: { ...(e.abilityUsesLeft || {}), [abilityIndex]: usesLeft } }
      : e);
    const patch = { inventory };
    if (result.kind === 'heal' || result.kind === 'damage') patch.currentHp = result.newCurrentHp;
    statusText = describeResult(item.abilities[abilityIndex].name, result);
    persist(patch);
  }

  function describeResult(name, result) {
    if (result.kind === 'heal') return `${name}: healed ${result.amount} (rolled ${result.rolls.join('+')})`;
    if (result.kind === 'damage') return `${name}: dealt ${result.amount} ${result.damageType} (rolled ${result.rolls.join('+')})`;
    if (result.kind === 'buff' || result.kind === 'debuff') return `${name}: ${result.kind}${result.statMods.length ? ' — ' + JSON.stringify(result.statMods) : ' (no numeric effect modeled yet)'}`;
    return `${name}: used`;
  }

  function slotOptionsFor(item) {
    return equipmentSlotsForItem(item).map(s => `<option value="${s}">${EQUIPMENT_SLOTS[s]}</option>`).join('');
  }

  function inventoryRowHtml(entry) {
    const item = resolveItem(entry.itemId);
    if (!item) return `<tr><td colspan="4">Unknown item "${escapeHtml(entry.itemId)}"</td></tr>`;
    const equippedInSlots = Object.entries(character.equippedSlots).filter(([, id]) => id === entry.instanceId).map(([slot]) => EQUIPMENT_SLOTS[slot]);
    const slots = equipmentSlotsForItem(item);
    let actionHtml = '—';
    if (slots.length) {
      actionHtml = equippedInSlots.length
        ? `<span class="cs-dim">Equipped: ${equippedInSlots.join(', ')}</span>`
        : `<select class="inv-equip-slot" data-instance-id="${entry.instanceId}"><option value="">Equip to…</option>${slotOptionsFor(item)}</select>`;
    } else if (item.itemType === 'consumable') {
      const usesLeft = entry.usesLeft ?? item.consumable.usesLeft;
      actionHtml = item.consumable.effects.map((e, i) =>
        `<button type="button" class="inv-use-btn" data-instance-id="${entry.instanceId}" data-effect-index="${i}" ${usesLeft <= 0 ? 'disabled' : ''}>Use (${e.kind})</button>`
      ).join(' ') + ` <span class="cs-dim">${usesLeft}/${item.consumable.uses.max}</span>`;
    } else if (item.abilities?.length) {
      actionHtml = item.abilities.map((a, i) => {
        const usesLeft = (entry.abilityUsesLeft || {})[i] ?? a.usesLeft;
        return `<button type="button" class="inv-activate-btn" data-instance-id="${entry.instanceId}" data-ability-index="${i}" ${usesLeft <= 0 ? 'disabled' : ''}>${escapeHtml(a.name)} (${usesLeft}/${a.uses.max})</button>`;
      }).join(' ');
    }
    return `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong> <span class="cs-dim">${item.itemType}</span></td>
        <td>${item.rarity}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }

  function render() {
    if (!loaded) { container.innerHTML = '<p>Loading inventory…</p>'; return; }
    const d = derived();
    container.innerHTML = `
      <div class="inventory-panel">
        <h2>Inventory &amp; Equipment (Phase 6)</h2>
        <p class="cs-dim">${escapeHtml(character.username || 'Unnamed')} — HP ${character.currentHp} / ${character.maxHpEffective ?? character.maxHp ?? d.maxHp} — AC <strong>${d.ac}</strong> ${statusText ? `<span class="cs-dim">— ${escapeHtml(statusText)}</span>` : ''}</p>

        <h3>Equipped</h3>
        <table class="inv-slots">
          <thead><tr><th>Slot</th><th>Item</th><th></th></tr></thead>
          <tbody>
            ${Object.entries(EQUIPMENT_SLOTS).map(([slotId, label]) => {
              const instanceId = character.equippedSlots[slotId];
              const entry = instanceId && character.inventory.find(e => e.instanceId === instanceId);
              const item = entry && resolveItem(entry.itemId);
              return `
                <tr>
                  <td>${label}</td>
                  <td>${item ? escapeHtml(item.name) : '<span class="cs-dim">empty</span>'}</td>
                  <td>${item ? `<button type="button" class="inv-unequip-btn" data-slot-id="${slotId}">Unequip</button>` : ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <h3>Owned Items</h3>
        <table class="inv-owned">
          <thead><tr><th>Item</th><th>Rarity</th><th>Action</th></tr></thead>
          <tbody>
            ${character.inventory.length ? character.inventory.map(inventoryRowHtml).join('') : '<tr><td colspan="3" class="cs-empty">Nothing owned yet — add something below.</td></tr>'}
          </tbody>
        </table>

        <h3>Add Item</h3>
        <div class="inv-add-row">
          <select id="inv-add-select">
            ${allItems.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (${i.itemType})</option>`).join('')}
          </select>
          <button type="button" id="inv-add-btn">+ Add to inventory</button>
        </div>
      </div>
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelectorAll('.inv-equip-slot').forEach(sel => {
      sel.addEventListener('change', e => {
        if (!e.target.value) return;
        doEquip(e.target.dataset.instanceId, e.target.value);
      });
    });
    container.querySelectorAll('.inv-unequip-btn').forEach(btn => {
      btn.addEventListener('click', e => doUnequip(e.target.dataset.slotId));
    });
    container.querySelectorAll('.inv-use-btn').forEach(btn => {
      btn.addEventListener('click', e => doUseConsumable(e.target.dataset.instanceId, Number(e.target.dataset.effectIndex)));
    });
    container.querySelectorAll('.inv-activate-btn').forEach(btn => {
      btn.addEventListener('click', e => doActivateAbility(e.target.dataset.instanceId, Number(e.target.dataset.abilityIndex)));
    });
    const addBtn = container.querySelector('#inv-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => addItemToInventory(container.querySelector('#inv-add-select').value));
  }

  load().catch(err => { container.innerHTML = `<p>Error loading inventory: ${err.message}</p>`; });
}
