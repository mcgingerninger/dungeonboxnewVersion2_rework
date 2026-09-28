// Minimal combat UI for Phase 3 of the mechanics rebuild: roster display, HP bars, add-monster,
// and an attack button — correctness over polish (initiative tracking, advantage/disadvantage
// controls, and a real DM Controls tab are Phase 6/7's job, not this one).
//
// Scoping note: this panel identifies over WebSocket using its own fixed test account
// ('demo-pc', role 'dm') rather than the Character Sheet tab's solo/guest character. The
// Character Sheet's solo slot is stored with a NULL account_uid (see db/schema.js), but the
// WebSocket identify protocol requires a real, non-empty accountUid string for every connection
// (it's also the room/roster key) — bridging those two identity models is a real design question
// for the DM Controls/multiplayer-sync porting work in Phase 6-8, not something to improvise here.
// This panel is self-contained: it creates its own demo PC character via REST if one doesn't
// exist yet, specifically so Phase 3's engine/persistence/broadcast slice can be verified
// end-to-end in a real browser without waiting on that later identity work.

const DEMO_PC_ACCOUNT = 'demo-pc';

function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

async function ensureDemoCharacter(campaignId) {
  const res = await fetch(`/campaigns/${campaignId}/characters/${DEMO_PC_ACCOUNT}`);
  if (res.ok) return res.json();
  const created = await fetch(`/campaigns/${campaignId}/characters/${DEMO_PC_ACCOUNT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Combat Test PC', level: 3, hitDieSize: 8, proficiencyBonus: 2,
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      ac: 13, currentHp: 20, maxHp: 20, maxHpEffective: 20,
    }),
  });
  return created.json();
}

export function mountCombatPanel(container, campaignId) {
  let combatState = { active: false, roundNumber: 0, roster: [], log: [] };
  let ws = null;
  let statusText = 'Connecting…';

  function render() {
    container.innerHTML = `
      <div class="combat-panel">
        <h2>Combat (Phase 3 — minimal, correctness-first)</h2>
        <p class="cs-dim">${statusText}</p>
        <div class="combat-add-row">
          <button type="button" id="cb-add-pc">+ Add Combat Test PC to roster</button>
          <span class="cb-add-monster">
            <input id="cb-m-name" placeholder="Monster name" value="Goblin">
            <input id="cb-m-ac" type="number" placeholder="AC" value="13" style="width:4em;">
            <input id="cb-m-hp" type="number" placeholder="HP" value="12" style="width:4em;">
            <input id="cb-m-atk" type="number" placeholder="Attack bonus" value="4" style="width:4em;">
            <input id="cb-m-dmg" placeholder="Damage dice" value="1d6" style="width:5em;">
            <button type="button" id="cb-add-monster">+ Add Monster</button>
          </span>
        </div>

        <h3>Roster</h3>
        <table class="combat-roster">
          <thead><tr><th>Name</th><th>Kind</th><th>AC</th><th>HP</th><th></th></tr></thead>
          <tbody>
            ${combatState.roster.map(e => `
              <tr data-entry-id="${e.id}">
                <td>${escapeHtml(e.name)}</td>
                <td>${e.kind}</td>
                <td>${e.ac}</td>
                <td>
                  <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${e.maxHp ? Math.max(0, Math.min(100, (e.currentHp / e.maxHp) * 100)) : 0}%"></div></div>
                  ${e.currentHp} / ${e.maxHp}
                </td>
                <td>${e.currentHp <= 0 ? '💀 defeated' : ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="cs-empty">No combatants yet.</td></tr>'}
          </tbody>
        </table>

        <h3>Attack</h3>
        <div class="combat-attack-row">
          <label>Attacker
            <select id="cb-attacker">${rosterOptions()}</select>
          </label>
          <label>Target
            <select id="cb-target">${rosterOptions()}</select>
          </label>
          <button type="button" id="cb-attack" ${combatState.roster.length < 2 ? 'disabled' : ''}>Attack (Unarmed Strike)</button>
        </div>

        <h3>Log</h3>
        <ul class="combat-log">
          ${combatState.log.slice(-15).reverse().map(l => `<li>${escapeHtml(l.message)} <span class="cs-dim">(margin ${l.result.margin}, roll ${l.result.toHitRoll})</span></li>`).join('') || '<li class="cs-empty">No attacks yet.</li>'}
        </ul>
      </div>
    `;
    attachListeners();
  }

  function rosterOptions() {
    return combatState.roster.map(e => `<option value="${e.id}">${escapeHtml(e.name)} (${e.kind})</option>`).join('');
  }

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

  function pushRoster(newRosterBare) {
    send({ type: 'push_combat_state', roster: newRosterBare, active: true, roundNumber: combatState.roundNumber });
  }

  // "Bare" roster entries are what push_combat_state actually stores — a 'pc' entry carries only
  // {id, kind, name, accountUid}; the server enriches ac/currentHp/maxHp live from the characters
  // table on every broadcast (see server/websocket.js's buildCombatRosterView). Stripping the
  // enriched fields back off here before re-pushing avoids ever accidentally persisting a stale
  // HP/AC snapshot into the bare roster row.
  function toBareRoster() {
    return combatState.roster.map(e => e.kind === 'pc'
      ? { id: e.id, kind: 'pc', name: e.name, accountUid: e.accountUid }
      : { id: e.id, kind: 'monster', name: e.name, ac: e.ac, currentHp: e.currentHp, maxHp: e.maxHp, attackBonus: e.attackBonus, damageDice: e.damageDice, damageType: e.damageType });
  }

  function attachListeners() {
    container.querySelector('#cb-add-pc').addEventListener('click', () => {
      if (combatState.roster.some(e => e.kind === 'pc' && e.accountUid === DEMO_PC_ACCOUNT)) return;
      const bare = [...toBareRoster(), { id: 'pc-' + DEMO_PC_ACCOUNT, kind: 'pc', name: 'Combat Test PC', accountUid: DEMO_PC_ACCOUNT }];
      pushRoster(bare);
    });
    container.querySelector('#cb-add-monster').addEventListener('click', () => {
      const name = container.querySelector('#cb-m-name').value || 'Monster';
      const ac = Number(container.querySelector('#cb-m-ac').value) || 10;
      const hp = Number(container.querySelector('#cb-m-hp').value) || 10;
      const attackBonus = Number(container.querySelector('#cb-m-atk').value) || 0;
      const damageDice = container.querySelector('#cb-m-dmg').value || '1d6';
      const bare = [...toBareRoster(), {
        id: 'm-' + Date.now(), kind: 'monster', name, ac, currentHp: hp, maxHp: hp,
        attackBonus, damageDice, damageType: 'bludgeoning',
      }];
      pushRoster(bare);
    });
    container.querySelector('#cb-attack').addEventListener('click', () => {
      const attackerId = container.querySelector('#cb-attacker').value;
      const targetId = container.querySelector('#cb-target').value;
      if (!attackerId || !targetId) return;
      send({ type: 'combat_attack', attackerId, targetId });
    });
  }

  ws = new WebSocket(wsUrl());
  ws.addEventListener('open', async () => {
    await ensureDemoCharacter(campaignId);
    send({ type: 'identify', campaignId, accountUid: DEMO_PC_ACCOUNT, role: 'dm', username: 'Combat Test DM' });
  });
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'identified') { statusText = 'Connected.'; render(); return; }
    if (msg.type === 'combat_state_update') {
      combatState = { active: msg.active, roundNumber: msg.roundNumber, roster: msg.roster, log: msg.log };
      render();
      return;
    }
    if (msg.type === 'error') { statusText = `Error: ${msg.message}`; render(); }
  });
  ws.addEventListener('close', () => { statusText = 'Disconnected.'; render(); });
  ws.addEventListener('error', () => { statusText = 'Connection error.'; render(); });

  render();
}
