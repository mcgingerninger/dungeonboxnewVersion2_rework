// Phases 5a-5d of the architecture migration (see docs/MIGRATION_PLAN.md, docs/ARCHITECTURE.md):
// WebSocket replacement for multiplayer-sync.js's core state push/listen loop
// (pushOwnState/startPlayerListener), its three cross-player writes (applyHpDelta,
// giftItemToPlayer, setPlayerInventoryFields), real-time loot-claim arbitration
// (createLootClaim/startLootClaimListener), DM-to-players battlefield/puzzle-log broadcast
// (pushBattlefieldState/startBattlefieldListener, pushPuzzleLogState/startPuzzleLogListener),
// the DM roster listener (startRosterListener), and the attack-request review queue
// (submitBattlefieldAttack/startAttackRequestListener/resolveAttackRequest).
//
// Phase 6e added the DM's per-player viewed-player spectator subscription
// (startViewedPlayerListener/stopViewedPlayerListener) and Phase 6f added player removal
// (removePlayer/removeAllPlayers) — both gaps the original Phase 5 audit missed (see
// docs/ARCHITECTURE.md's Phase 6 section). Firebase Auth and the login/account UI were replaced
// by Phase 6b/6c's room-code identity model, not by this file — see docs/ARCHITECTURE.md.
//
// Loot claims deliberately do NOT carry the actual item data over this layer, matching the
// original design exactly: a claim only records who won the race for a given claim id (see
// db/schema.js's loot_claims table) — delivering the actual item to the winner is a separate
// concern (battlefield state), same as the original split between createLootClaim (just the
// claim doc) and the reactive listener that applies an ALREADY locally-known item once a player
// learns they won.
//
// Deliberate, documented gap: this server does NOT cryptographically verify a client's claimed
// identity (accountUid/role) — it trusts whatever the `identify` message says, the same trust
// model Phase 4 already established for gambling. Real verification would mean pulling in
// Firebase Admin SDK to check ID tokens server-side, which is a separate concern from what this
// slice is about (sync-loop correctness, not authentication).
//
// Message protocol (JSON over the WebSocket connection):
//   client -> server:
//     { type: 'identify', campaignId, accountUid, role, username }   -- must be sent first
//     { type: 'push_state', rev, state }                              -- persists the sender's own state
//     { type: 'hp_delta', targetUid, delta }                          -- DM only
//     { type: 'gift_item', targetUid, item }                          -- DM only
//     { type: 'set_inventory_fields', targetUid, fields }             -- DM only
//     { type: 'create_loot_claim', claimId, claimedByUid, claimedByUsername }
//       -- claimedByUid must equal the sender's own accountUid (self-loot), UNLESS the sender is
//       -- the DM claiming on someone else's behalf (a gift) — matching dmGiveLootItem's own
//       -- permission check in the original.
//     { type: 'push_battlefield', battleRoster, battleLog }        -- DM only
//     { type: 'push_battle_map', activeBattleMap, battleMapTokens } -- DM only; the chosen Map
//       -- Builder map (or null) and every placed token's position, merged into the same
//       -- battlefield_broadcast row push_battlefield writes to
//     { type: 'push_puzzle_log', puzzleLog }                       -- DM only
//     { type: 'submit_attack_request', attack }                    -- any player, their own attack
//     { type: 'resolve_attack_request', requestId }                -- DM only (apply/dismiss both
//       -- resolve the same way in the original: delete the request doc — this file doesn't need
//       -- to know which)
//     { type: 'subscribe_player', targetUid }                      -- DM only (Phase 6e); only one
//       -- active subscription per DM connection — a later subscribe_player silently replaces the
//       -- previous target, matching startViewedPlayerListener's own "only ever one of these
//       -- active at a time" in the original
//     { type: 'unsubscribe_player' }                                -- DM only (Phase 6e)
//     { type: 'kick_player', targetUid }                            -- DM only (Phase 6f); cannot
//       -- target the DM's own accountUid
//     { type: 'push_gambling_state', state }                        -- DM only (Phase 6d); state is
//       -- the monolith's own { game, table } shape, pushed verbatim on every host/close/DM-side
//       -- action-apply, matching pushBattlefieldState's role in the original design
//     { type: 'submit_gambling_action', action }                    -- any player, their own bet/
//       -- hit/stand/spin/hold/discard/fold (Phase 6d) — relayed live to the DM's connection for
//       -- the DM's own client to apply (the dealer logic itself is the authority, not a manual
//       -- DM review click, unlike an attack request)
//     { type: 'buy_staple', merchantKey, index, maxStock }           -- any connected account;
//       -- maxStock is the merchant's full static staple-stock array (MERCHANTS[key].staples'
//       -- own stock numbers), sent by the client so the server can lazily seed shared stock the
//       -- first time this merchant is ever bought from in a campaign, without needing to know
//       -- the merchant catalog itself — see the module comment above buy_staple's handler
//     { type: 'restock_merchant', merchantKey, maxStock }            -- DM only; resets a
//       -- merchant's shared stock back to full for everyone
//     { type: 'simulate_day' }                                       -- DM only (Phase 6k); a long
//       -- rest for every OTHER player in the campaign (the DM's own client already applied it
//       -- locally before sending this — see simulateADay's own comment in the main app),
//       -- mutating each player's PERSISTED state directly so it reaches players who aren't even
//       -- connected right now, same reasoning as hp_delta/gift_item/set_inventory_fields above
//     { type: 'push_combat_state', roster, active, roundNumber }        -- DM only (Phase 3 of the
//       -- mechanics rebuild); wholesale-replaces the combat subsystem's roster/active/
//       -- roundNumber, same "DM sends the whole list, server just persists+broadcasts it" shape
//       -- as push_battlefield. A roster entry is either { id, kind:'pc', name, accountUid } (AC/
//       -- HP always read live from the `characters` table, never duplicated here) or
//       -- { id, kind:'monster', name, ac, currentHp, maxHp, attackBonus, damageDice, damageType }
//       -- (fully self-contained — no monster-stat-block system exists yet, that's Phase 7.2).
//     { type: 'combat_attack', attackerId, targetId }                   -- any identified
//       -- connection (not DM-only — either side may trigger their own PC's attack); the SERVER
//       -- calls src/engine/combat/attack.js's resolveAttack itself using its own copy of both
//       -- roster entries' state, never a client-supplied roll — closes the old app's
//       -- unvalidated-client-computed-roll gap. Unarmed-strike only for now (UNARMED_STRIKE_
//       -- ACTION) since no item system exists yet; a monster attacker uses its roster entry's own
//       -- attackBonus/damageDice/damageType instead.
//   server -> client:
//     { type: 'identified', state, rev }             -- ack, plus whatever was already persisted for this account
//     { type: 'push_ack', rev }                       -- confirms a push_state was actually persisted
//     { type: 'push_rejected', reason, rev }          -- a push_state was dropped as stale (see the rev check below)
//     { type: 'cross_write_ack', targetUid, rev }     -- confirms hp_delta/gift_item/set_inventory_fields landed (sent to the DM)
//     { type: 'state_update', state, rev }            -- this account's state changed (a DM cross-write landed) (sent to the target)
//     { type: 'loot_claim_result', claimId, won, claimedByUid, claimedByUsername }
//       -- sent back to whoever sent create_loot_claim: won=true if THEY won the race, false (with
//       -- the actual winner's identity) if someone already claimed it first
//     { type: 'loot_claim_update', claimId, claimedByUid, claimedByUsername }
//       -- sent to the DM's live connection (if they weren't the one claiming) so their roster
//       -- can mark the item claimed, matching markLootClaimOnRoster's role in the original
//     { type: 'push_battlefield_ack' } / { type: 'push_puzzle_log_ack' } -- confirms the DM's push landed
//     { type: 'battlefield_update', battleRoster, battleLog }     -- broadcast to every connected
//       -- PLAYER (never the DM) on a push, AND sent once on identify if something was already
//       -- published, so a reconnecting/late-joining player catches up immediately rather than
//       -- waiting for the next DM action — matching what Firestore's onSnapshot already did by
//       -- firing immediately with whatever the doc already held on subscribe.
//     { type: 'push_battle_map_ack' } / { type: 'battle_map_update', activeBattleMap,
//       -- battleMapTokens } -- same push/broadcast/catch-up shape as push_battlefield above, kept
//       -- as its own message type since the map/tokens change on a different rhythm than the
//       -- roster and don't need any loot-style filtering.
//     { type: 'puzzle_log_update', puzzleLog }                    -- same broadcast/catch-up shape
//     { type: 'roster_update', roster }                           -- sent to the DM's live connection
//       -- only, whenever a connected player's stats might have changed (their own push, or a
//       -- cross-write landing) or a player connects/disconnects, AND once immediately when the
//       -- DM themselves identifies — see buildRoster below for what it contains and the one
//       -- real simplification versus the original (connected players only, not every player
//       -- who's ever joined).
//     { type: 'attack_request_list', requests }                   -- sent to the DM's live
//       -- connection with the FULL current pending list (never a diff), on every submit/resolve
//       -- — matching startAttackRequestListener's own "hands the main file the full current
//       -- list... on every change" behavior in the original.
//     { type: 'attack_request_submitted', requestId }             -- ack to the submitting player
//     { type: 'attack_request_resolved', requestId }               -- ack to the DM after resolving
//     { type: 'player_state_update', targetUid, state }            -- Phase 6e: sent to whichever
//       -- DM connection is currently subscribed (via subscribe_player) to targetUid, on every
//       -- push_state or cross-write affecting that target, AND once immediately on subscribe
//       -- (catch-up, same "fire immediately with whatever's already there" spirit as
//       -- battlefield_update/puzzle_log_update above) — state is null if the target has never
//       -- pushed anything yet
//     { type: 'kicked' }                                           -- Phase 6f: sent to a removed
//       -- player's live connection just before the server closes it
//     { type: 'kick_ack', targetUid }                               -- Phase 6f: ack to the DM
//     { type: 'gambling_state_update', state }                     -- Phase 6d: broadcast to every
//       -- connected PLAYER (never the DM, same as battlefield_update — the DM is the one who just
//       -- pushed it) on push_gambling_state, AND sent once on identify if a table is already
//       -- hosted, matching the battlefield/puzzle-log catch-up pattern exactly
//     { type: 'push_gambling_state_ack' }                           -- Phase 6d: confirms the DM's
//       -- push landed, matching push_battlefield_ack/push_puzzle_log_ack
//     { type: 'gambling_action_list', actions }                     -- Phase 6d: sent to the DM's
//       -- live connection with ONE action per submit_gambling_action (never batched/queued —
//       -- see the deliberate-simplification note below), wrapped in a list because that's the
//       -- shape the monolith's window.applyIncomingGamblingActions already expects
//     { type: 'gambling_action_submitted' }                        -- Phase 6d: ack to the
//       -- submitting player
//     { type: 'buy_staple_result', merchantKey, index, bought }     -- sent to the buyer only;
//       -- bought is false if the server's own arbitration found nothing left
//     { type: 'merchant_stock_update', merchantKey, remaining }     -- broadcast to EVERY
//       -- connection in the room (the DM included, unlike every other broadcast type above) on
//       -- a successful buy_staple OR a restock_merchant — remaining is the merchant's full
//       -- current stock array, always a full replace, never a per-index patch
//     { type: 'merchant_stock_full', stock }                        -- sent to both roles right
//       -- after identify, catch-up for whatever merchant stock already exists in this campaign
//       -- (stock is { [merchantKey]: [...] } for every merchant with any persisted state; absent
//       -- entirely if nothing has ever been bought from anyone yet)
//     { type: 'simulate_day_ack' }                                  -- Phase 6k: confirms a
//       -- simulate_day was applied to every other player's persisted state (sent to the DM)
//     { type: 'day_advanced' }                                      -- Phase 6k: broadcast to
//       -- every connected PLAYER (never echoed back to the triggering DM — their own client
//       -- already did this locally) on a simulate_day; each player's own daily wares reroll
//       -- locally in response (see the main app's window.onDayAdvanced) — their character
//       -- long-rest itself arrives separately via the ordinary state_update above
//     { type: 'combat_state_update', active, roundNumber, roster, log }  -- broadcast to EVERY
//       -- connection in the room (DM included, same reasoning merchant_stock_update already
//       -- uses — combat has no single "owner" the way battlefield/puzzle-log do, both sides need
//       -- to see it live) on a push_combat_state or a resolved combat_attack, AND sent once on
//       -- identify (both roles) if a fight is already in progress, same immediate-catch-up spirit
//       -- as every other broadcast subsystem. `roster` here is the ENRICHED view — a 'pc' entry
//       -- has its ac/currentHp/maxHp merged in live from the characters table (see
//       -- buildCombatRosterView), never the bare { id, kind, name, accountUid } push_combat_state
//       -- itself stores.
//     { type: 'error', message }
//
// The ack types matter for more than bookkeeping: the original Firestore design lets a caller
// await pushOwnState's/applyHpDelta's own promise to know a write actually landed. Without an
// equivalent signal here, any caller (including this file's own tests) has no way to know a
// write has actually been persisted except guessing a fixed delay — which is genuinely unsafe
// under variable load, and was confirmed to cause real, if infrequent, test flakiness before
// these acks were added.
//
// Self-echo (Firestore's onSnapshot always echoing a client's own writes back to it, which
// multiplayer-sync.js's rev/extRev counters exist specifically to filter back out) simply isn't
// a problem here: the server is stateful and knows exactly which connection sent a push, so it
// never sends that connection a state_update for its own push. What's left is a much smaller
// problem — genuinely out-of-order delivery of rapid successive pushes from the SAME client —
// handled by the `rev` staleness check below.
//
// Battlefield loot-visibility filtering (push_battlefield) replicates the original's
// pushBattlefieldState exactly: an ALLOWLIST of safe fields (never a blacklist of sensitive
// ones — "there is nothing for a player to find via devtools that the DM hasn't chosen to
// share," per the original's own comment), loot entirely absent until lootRevealed is set, and
// even after reveal, reserved/already-claimed items stripped individually. See
// filterBattleRosterForPlayers below.
//
// Deliberate simplification: the original debounced both battlefield/puzzle-log pushes
// client-side by 400ms, purely to limit Firestore WRITE FREQUENCY (a real cost/quota concern
// for a cloud database billed per write). That reasoning doesn't transfer to a local SQLite file
// the DM's own server process writes to — there's no per-write cost to amortize — so this phase
// does not replicate the debounce. Noted here explicitly as a considered omission.
//
// Deliberate simplification: the DM roster (buildRoster) reflects CURRENTLY CONNECTED players
// only, derived from this file's own in-memory `rooms` map plus their persisted player_states
// row for stats. The original tracked every player who had EVER joined the campaign (Firestore's
// collection listener sees every doc regardless of whether that browser is currently open),
// including a last-known username/role even for someone offline. Replicating that fully would
// mean persisting username/role alongside player_states (today it only stores the state blob +
// rev) — a real, if small, schema change judged not worth it for this final sub-phase given the
// roster's main practical use (targeting a live player in combat) only matters for players who
// are actually connected right now. Noted here as a genuine, deliberate scope reduction, not an
// oversight.
//
// Deliberate simplification (Phase 6d): submit_gambling_action is relayed LIVE to the DM's
// connection, never persisted in a durable table the way attack_requests is. Two reasons this is
// the right tradeoff here, not laziness: (1) the monolith's own applyIncomingGamblingActions
// applies an incoming action immediately on the DM's client and re-pushes the resulting state —
// there is no manual "does this look right" review step the way an attack request has, so a
// queue a DM manually works through doesn't match how this feature actually behaves; (2)
// gambling already assumes the DM is the live dealer (see the monolith's own GAMBLING comment —
// "the DM is always the dealer/host"), so an action arriving while the DM is briefly
// disconnected is lost the same way it would be if a real dealer stepped away from the table —
// acceptable, not silently swallowed forever (the player's own client still shows its own
// submitted bet/action locally until the next state broadcast reconciles it). If this ever needs
// to survive a DM reconnect, the fix is a small table shaped like attack_requests, not a redesign
// of this relay.

import { WebSocketServer } from 'ws';
import {
  getCampaign, savePlayerState, loadPlayerState, loadAllPlayerStates, deletePlayerState, createLootClaim,
  saveSubsystemState, loadSubsystemState,
  createAttackRequest, listAttackRequests, deleteAttackRequest,
  getCharacter, upsertCharacter,
} from '../db/database.js';
import { applyLongRestToPlayerState, applyItemEffectToState, applyTrapEffectToState } from '../game-engine.js';
import { resolveAttack, UNARMED_STRIKE_ACTION } from '../src/engine/combat/attack.js';

// Phase 6d: real-time gambling sync, the one gap left over from the original Phase 5 audit (see
// docs/ARCHITECTURE.md's Phase 6 section — deliberately deprioritized until now). Reuses Phase
// 2's existing 'gambling' subsystem bucket (the same storage server/gambling.js's REST routes
// already read/write) rather than adding a new table — this is genuinely the same data, just
// with a live push/listen loop added on top so it actually reaches connected players.

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// Phase 6d: gambling actions are never persisted (see the module comment above), so they need no
// database-assigned id — just something unique enough for the DM's client to pass back to
// resolveGamblingActionRemote if it chooses to.
let _gamblingActionCounter = 0;
function generateId() {
  return 'ga' + (++_gamblingActionCounter) + '_' + Date.now().toString(36);
}

// Mirrors pushBattlefieldState's own destructuring exactly — same allowlisted field set, same
// loot-reveal/reservation/claim filtering.
function filterBattleRosterForPlayers(battleRoster) {
  return (battleRoster || []).map((entry) => {
    const { uid, monster, displayName, variant, traits, chaosGearList, hp, maxHp, hpRoll, ac, statLines, lastResult, defeated, loot, lootRevealed, isCorpse } = entry;
    const out = { uid, monster, displayName, variant, traits, chaosGearList, hp, maxHp, hpRoll, ac, statLines, lastResult, defeated, isCorpse };
    if (loot && lootRevealed) out.loot = { tier: loot.tier, gold: loot.gold, items: (loot.items || []).filter(it => !it.reserved && !it.claimedBy) };
    return out;
  });
}

export function createWebSocketServer(db, httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  // campaignId -> Map<accountUid, {ws, role, username}> — for the DM to reach a specific
  // player's live connection on a cross-player write, and (Phase 5b) for a player's loot claim
  // to reach the DM's live connection regardless of the DM's own uid. Rebuilt from scratch on
  // every connect/close rather than trying to keep a separate reverse index in sync.
  const rooms = new Map();

  function roomFor(campaignId) {
    if (!rooms.has(campaignId)) rooms.set(campaignId, new Map());
    return rooms.get(campaignId);
  }
  function findDmConnection(campaignId) {
    for (const entry of roomFor(campaignId).values()) {
      if (entry.role === 'dm') return entry.ws;
    }
    return null;
  }
  // Phase 5c: every connected PLAYER (never the DM — matching startBattlefieldListener/
  // startPuzzleLogListener only ever being started for role !== 'dm' in the original).
  function broadcastToPlayers(campaignId, msg) {
    for (const entry of roomFor(campaignId).values()) {
      if (entry.role !== 'dm') send(entry.ws, msg);
    }
  }
  // Store purchase sync: unlike battlefield/puzzle-log/gambling (all DM-authored, so the DM
  // never needs its own broadcast echoed back), merchant stock has no single owner — anyone
  // connected can deplete it, and EVERYONE (the DM included) needs to see the result live, so
  // this reaches every connection in the room regardless of role.
  function broadcastToRoom(campaignId, msg) {
    for (const entry of roomFor(campaignId).values()) send(entry.ws, msg);
  }

  // Phase 3 of the mechanics rebuild: reads the persisted combat subsystem (bare roster entries —
  // a 'pc' entry stores only { id, kind, name, accountUid }, never AC/HP) and returns the
  // enriched view clients actually render, merging each 'pc' entry's live ac/currentHp/maxHp in
  // from the `characters` table. A 'monster' entry is already fully self-contained and passes
  // through unchanged. Returns null if no combat has been started in this campaign yet.
  function buildCombatRosterView(campaignId) {
    const combat = loadSubsystemState(db, campaignId, 'combat');
    if (!combat) return null;
    const roster = (combat.roster || []).map(entry => {
      if (entry.kind !== 'pc') return entry;
      const character = getCharacter(db, campaignId, entry.accountUid);
      if (!character) return { ...entry, ac: 10, currentHp: 0, maxHp: 0 };
      return { ...entry, ac: character.ac, currentHp: character.currentHp, maxHp: character.maxHpEffective ?? character.maxHp };
    });
    return { active: !!combat.active, roundNumber: combat.roundNumber || 0, roster, log: combat.log || [] };
  }

  // Builds the attacker/target/weaponOrAction shapes resolveAttack expects from a raw roster
  // entry — a 'pc' entry's combat stats come from the characters table (ability scores,
  // proficiency bonus, ac, current HP), a 'monster' entry is self-contained on the roster row
  // itself. Returns null if the entry can't be resolved (unknown id, or a 'pc' entry whose
  // character record vanished).
  function combatCombatantFor(campaignId, entry) {
    if (!entry) return null;
    if (entry.kind === 'pc') {
      const character = getCharacter(db, campaignId, entry.accountUid);
      if (!character) return null;
      return {
        attacker: { abilityScores: character.abilityScores, proficiencyBonus: character.proficiencyBonus },
        target: { ac: character.ac },
        currentHp: character.currentHp,
        action: UNARMED_STRIKE_ACTION,
      };
    }
    return {
      attacker: {},
      target: { ac: entry.ac },
      currentHp: entry.currentHp,
      action: { damageDice: entry.damageDice, damageType: entry.damageType, toHitBonus: entry.attackBonus, damageBonus: entry.damageBonus ?? 0 },
    };
  }

  // Phase 5d. See the module comment above for the one real simplification versus the original
  // (connected players only). Clamping mirrors startRosterListener's own clamp exactly.
  //
  // Found during Phase 6e's browser testing (the first sub-phase to actually exercise the
  // monolith's Players tab live): this was missing a `role` field on every entry. The original's
  // own roster entries always carried `role: d.role` (see startRosterListener), and the
  // monolith's renderPlayersTab() filters on exactly `p.role === 'player'` — without it, every
  // entry was silently excluded, so the Players tab has shown "No players have joined yet." since
  // Phase 5d, undetected because nothing exercised that specific consumer until now. Every entry
  // here is already known to be a player (the `dm` check above), so this is just `'player'`.
  function buildRoster(campaignId) {
    const roster = [];
    for (const [accountUid, entry] of roomFor(campaignId).entries()) {
      if (entry.role === 'dm') continue;
      const stateEntry = loadPlayerState(db, campaignId, accountUid);
      const s = stateEntry ? stateEntry.state : {};
      const maxHp = typeof s.characterMaxHpEffective === 'number' ? s.characterMaxHpEffective : s.characterMaxHp;
      const currentHp = typeof s.characterCurrentHp === 'number' && typeof maxHp === 'number'
        ? Math.max(0, Math.min(s.characterCurrentHp, maxHp)) : s.characterCurrentHp;
      roster.push({
        uid: accountUid, username: entry.username || 'Unnamed', role: 'player', currentHp, maxHp, ac: s.characterAc,
        characterClass: s.characterClass, characterRace: s.characterRace, characterAffinity: s.characterAffinity,
        initiative: typeof s.characterInitiative === 'number' ? s.characterInitiative : 0,
        speed: typeof s.characterSpeedEffective === 'number' ? s.characterSpeedEffective
          : (typeof s.characterSpeed === 'number' ? s.characterSpeed : 30),
      });
    }
    return roster;
  }
  function broadcastRoster(campaignId) {
    const dmWs = findDmConnection(campaignId);
    if (dmWs) send(dmWs, { type: 'roster_update', roster: buildRoster(campaignId) });
  }

  // Phase 6e: the DM's Players-tab spectator view — a live, read-only look at ONE specific
  // player's full state, separate from buildRoster (which only ever extracts a thin HP/AC
  // summary for every player at once). Only ever one DM connection could plausibly be viewing at
  // a time in practice, but this checks every connection in the room rather than assuming a
  // single DM, same defensive shape findDmConnection already uses.
  function notifyViewers(campaignId, targetUid, state) {
    for (const entry of roomFor(campaignId).values()) {
      if (entry.viewingUid === targetUid) send(entry.ws, { type: 'player_state_update', targetUid, state });
    }
  }

  wss.on('connection', (ws) => {
    let identity = null; // { campaignId, accountUid, role, username }

    // Heartbeat (see HEARTBEAT_INTERVAL_MS below): browsers reply to a ping frame with a pong
    // automatically, no client-side code needed — this is purely a protocol-level keepalive.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return send(ws, { type: 'error', message: 'Malformed JSON message' }); }

      if (msg.type === 'identify') {
        const campaignId = Number(msg.campaignId);
        if (!Number.isInteger(campaignId) || !getCampaign(db, campaignId)) {
          return send(ws, { type: 'error', message: `No campaign with id ${msg.campaignId}` });
        }
        if (!msg.accountUid || typeof msg.accountUid !== 'string') {
          return send(ws, { type: 'error', message: '"accountUid" is required' });
        }
        // Phase 6c found this the hard way: a second connection identifying with an accountUid
        // that's already live (e.g. the DM opening a second tab, or a page reload racing its own
        // still-closing old connection) would otherwise silently REPLACE the map entry without
        // touching the old connection at all. The old tab looks connected (its socket is still
        // open) but is now untracked — no roster/battlefield/puzzle broadcasts reach it, and if
        // it's the DM, findDmConnection stops finding them entirely. Worse: if that orphaned old
        // connection later closes, its own close handler's `room.get(uid)?.ws === ws` check
        // correctly no-ops (the map already points at the new ws) — so this wasn't crashing
        // anything, it was just going quietly deaf, which is harder to notice than a crash.
        // Explicitly closing the old connection (with a reason) converts an invisible zombie
        // connection into a visible, honest "you're connected elsewhere now."
        const room = roomFor(campaignId);
        const displaced = room.get(msg.accountUid);
        if (displaced && displaced.ws !== ws && displaced.ws.readyState === displaced.ws.OPEN) {
          send(displaced.ws, { type: 'error', message: 'Connected from another tab or device — this connection is being closed.' });
          displaced.ws.close();
        }
        identity = { campaignId, accountUid: msg.accountUid, role: msg.role, username: msg.username };
        // viewingUid: Phase 6e — which OTHER player's live state this connection is currently
        // subscribed to (DM only; null for everyone else, and null here until subscribe_player).
        room.set(msg.accountUid, { ws, role: msg.role, username: msg.username, viewingUid: null });
        const existing = loadPlayerState(db, campaignId, msg.accountUid);
        send(ws, { type: 'identified', state: existing ? existing.state : null, rev: existing ? existing.rev : 0 });
        // Store purchase sync: unlike the player-only catch-ups below, merchant stock matters to
        // BOTH roles equally (the DM's own store view needs to show accurate stock too), so this
        // sends regardless of role, right after identify, same immediate-catch-up spirit as the
        // rest — a merchant nobody's bought anything from yet simply has no persisted stock.
        const merchantStock = loadSubsystemState(db, campaignId, 'merchant_stock');
        if (merchantStock) send(ws, { type: 'merchant_stock_full', stock: merchantStock });
        // Phase 3 of the mechanics rebuild: combat matters to both roles equally (same reasoning
        // merchant stock catch-up above already uses), so this sends regardless of role too.
        const combatView = buildCombatRosterView(campaignId);
        if (combatView) send(ws, { type: 'combat_state_update', ...combatView });
        if (msg.role !== 'dm') {
          // Phase 5c: a player who just (re)connected should see whatever the DM already
          // published, not wait for the next push — matching Firestore's onSnapshot firing
          // immediately with the doc's current contents the moment a listener subscribes.
          const battlefield = loadSubsystemState(db, campaignId, 'battlefield_broadcast');
          if (battlefield) send(ws, { type: 'battlefield_update', battleRoster: battlefield.battleRoster, battleLog: battlefield.battleLog });
          if (battlefield && (battlefield.activeBattleMap || (battlefield.battleMapTokens || []).length)) {
            send(ws, { type: 'battle_map_update', activeBattleMap: battlefield.activeBattleMap || null, battleMapTokens: battlefield.battleMapTokens || [] });
          }
          const puzzleLog = loadSubsystemState(db, campaignId, 'puzzle_log_broadcast');
          if (puzzleLog) send(ws, { type: 'puzzle_log_update', puzzleLog: puzzleLog.puzzleLog });
          // Phase 6d: same catch-up spirit — a player joining/reconnecting mid-hand should see
          // the currently hosted table immediately, not wait for the next DM action.
          const gambling = loadSubsystemState(db, campaignId, 'gambling');
          if (gambling && gambling.game) send(ws, { type: 'gambling_state_update', state: gambling });
          // Phase 5d: this player joining/reconnecting changes what the DM's roster should show.
          broadcastRoster(campaignId);
        } else {
          // Phase 5d: the DM gets an immediate initial roster and pending-attack list on their
          // own identify, same catch-up spirit as the player-facing broadcasts above.
          send(ws, { type: 'roster_update', roster: buildRoster(campaignId) });
          send(ws, { type: 'attack_request_list', requests: listAttackRequests(db, campaignId) });
        }
        return;
      }

      if (!identity) return send(ws, { type: 'error', message: 'Send "identify" before anything else' });

      if (msg.type === 'push_state') {
        const rev = Number(msg.rev) || 0;
        const existing = loadPlayerState(db, identity.campaignId, identity.accountUid);
        // Out-of-order guard: a rapid second push whose network round-trip finishes before an
        // even-newer push's does not get to clobber the newer one. This is the one piece of the
        // original's rev logic that's still needed — the self-echo half is gone by construction
        // (see the module comment above).
        if (existing && rev <= existing.rev) return send(ws, { type: 'push_rejected', reason: 'stale rev', rev });
        savePlayerState(db, identity.campaignId, identity.accountUid, msg.state, rev);
        // The original Firestore design lets a caller know a push actually landed — pushOwnState
        // returns the promise from `await setDoc(...)`. This ack is that same guarantee over
        // WebSocket: a caller (or a test) can wait for confirmation instead of assuming a fixed
        // delay was long enough, which is genuinely unsafe under variable system load.
        send(ws, { type: 'push_ack', rev });
        if (identity.role !== 'dm') broadcastRoster(identity.campaignId); // Phase 5d: stats may have changed
        notifyViewers(identity.campaignId, identity.accountUid, msg.state); // Phase 6e
        return;
      }

      if (msg.type === 'subscribe_player') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can view a player.' });
        const entry = roomFor(identity.campaignId).get(identity.accountUid);
        if (entry) entry.viewingUid = msg.targetUid;
        // Catch-up, matching the original's onSnapshot firing immediately with whatever the doc
        // already held the moment a listener subscribes — the DM shouldn't have to wait for the
        // target's NEXT action just to see their current state.
        const existingTarget = loadPlayerState(db, identity.campaignId, msg.targetUid);
        send(ws, { type: 'player_state_update', targetUid: msg.targetUid, state: existingTarget ? existingTarget.state : null });
        return;
      }

      if (msg.type === 'unsubscribe_player') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can do that.' });
        const entry = roomFor(identity.campaignId).get(identity.accountUid);
        if (entry) entry.viewingUid = null;
        return;
      }

      if (msg.type === 'hp_delta' || msg.type === 'gift_item' || msg.type === 'set_inventory_fields' || msg.type === 'apply_item_effect' || msg.type === 'apply_trap_effect' || msg.type === 'initiative_delta' || msg.type === 'toggle_unlock_achieved' || msg.type === 'speed_delta') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can do that' });
        const targetUid = msg.targetUid;
        const existing = loadPlayerState(db, identity.campaignId, targetUid) || { state: {}, rev: 0 };
        let nextState = { ...existing.state };

        if (msg.type === 'hp_delta') {
          const current = typeof nextState.characterCurrentHp === 'number' ? nextState.characterCurrentHp : 0;
          const max = typeof nextState.characterMaxHpEffective === 'number' ? nextState.characterMaxHpEffective
            : (typeof nextState.characterMaxHp === 'number' ? nextState.characterMaxHp : undefined);
          const proposed = current + (Number(msg.delta) || 0);
          nextState.characterCurrentHp = max != null ? Math.max(0, Math.min(proposed, max)) : Math.max(0, proposed);
        } else if (msg.type === 'gift_item') {
          const saved = { ...msg.item, id: Date.now() + '_' + Math.random().toString(36).slice(2) };
          nextState.savedGeneratedItems = [...(nextState.savedGeneratedItems || []), saved];
          nextState.recentlyLooted = [...(nextState.recentlyLooted || []), 'gen:' + saved.id];
        } else if (msg.type === 'set_inventory_fields') {
          Object.assign(nextState, msg.fields || {});
        } else if (msg.type === 'apply_item_effect') {
          // DM administers an item's effect directly to a player's persisted state -- must work
          // even if they're offline, same reasoning hp_delta/gift_item/simulate_day already use.
          // Uses the same shared, tested effect-application function the client's own use/drink
          // flow will eventually be able to reuse, rather than re-deriving HP/duration parsing here.
          nextState = applyItemEffectToState(nextState, msg.item || {});
        } else if (msg.type === 'apply_trap_effect') {
          // Same reasoning as apply_item_effect, for the Traps & Hazards compendium's own
          // "Apply to Player" tool -- msg.saved reflects a saving throw the DM already resolved
          // at the table (or true for an effect with no save at all).
          nextState = applyTrapEffectToState(nextState, msg.trap || {}, !!msg.saved);
        } else if (msg.type === 'initiative_delta') {
          // DM-only counter, unlike hp_delta -- no clamp, since initiative has no natural min/max
          // (a heavily-penalized roll can legitimately go negative).
          const current = typeof nextState.characterInitiative === 'number' ? nextState.characterInitiative : 0;
          nextState.characterInitiative = current + (Number(msg.delta) || 0);
        } else if (msg.type === 'toggle_unlock_achieved') {
          // Flips one item's hidden-power tier between achieved/not for this player -- the DM is
          // the sole judge of whether the tier's condition was actually met at the table, so this
          // (like every other branch here) only ever runs for identity.role === 'dm'.
          const itemKey = String(msg.itemKey || '');
          const tierIndex = Number(msg.tierIndex);
          const list = Array.isArray(nextState.achievedUnlocks) ? nextState.achievedUnlocks.slice() : [];
          const idx = list.findIndex(a => a.itemKey === itemKey && a.tierIndex === tierIndex);
          if (idx === -1) list.push({ itemKey, tierIndex }); else list.splice(idx, 1);
          nextState.achievedUnlocks = list;
        } else if (msg.type === 'speed_delta') {
          // Base movement speed, DM-adjustable like initiative -- clamped at 0 (unlike
          // initiative) since a negative walking speed isn't meaningful.
          const current = typeof nextState.characterSpeed === 'number' ? nextState.characterSpeed : 30;
          nextState.characterSpeed = Math.max(0, current + (Number(msg.delta) || 0));
        }

        const nextRev = existing.rev + 1;
        savePlayerState(db, identity.campaignId, targetUid, nextState, nextRev);
        const target = roomFor(identity.campaignId).get(targetUid);
        if (target) send(target.ws, { type: 'state_update', state: nextState, rev: nextRev });
        // Acks the DM's OWN connection, separately from the target's state_update above — lets
        // the DM's client (or a test) know the write actually landed, the same guarantee
        // push_ack gives a player pushing their own state. Same reasoning: a client shouldn't
        // have to guess how long "probably done by now" is.
        send(ws, { type: 'cross_write_ack', targetUid, rev: nextRev });
        broadcastRoster(identity.campaignId); // Phase 5d: the target's stats (e.g. HP) may have changed
        notifyViewers(identity.campaignId, targetUid, nextState); // Phase 6e
        return;
      }

      // Phase 6k: "Simulate a Day" — a long rest for every player in the campaign PLUS a shop
      // restock. The DM's own client already applied the long rest to its own local character
      // and rerolled every merchant's daily wares before ever sending this (see simulateADay's
      // own comment in the main app) — this only needs to reach everyone ELSE, including anyone
      // not currently connected, which is exactly why this mutates the PERSISTED row for every
      // player directly (loadAllPlayerStates/savePlayerState) rather than only pushing to live
      // sockets, the same reasoning hp_delta/gift_item/set_inventory_fields above already use.
      if (msg.type === 'simulate_day') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can do that.' });
        const allStates = loadAllPlayerStates(db, identity.campaignId);
        for (const { accountUid, state, rev } of allStates) {
          if (accountUid === identity.accountUid) continue; // the DM's own client already rested locally
          const nextState = applyLongRestToPlayerState(state);
          const nextRev = rev + 1;
          savePlayerState(db, identity.campaignId, accountUid, nextState, nextRev);
          const target = roomFor(identity.campaignId).get(accountUid);
          if (target) send(target.ws, { type: 'state_update', state: nextState, rev: nextRev });
        }
        broadcastRoster(identity.campaignId); // every player's HP just changed
        broadcastToPlayers(identity.campaignId, { type: 'day_advanced' }); // reroll everyone's own local daily wares
        send(ws, { type: 'simulate_day_ack' });
        return;
      }

      if (msg.type === 'create_loot_claim') {
        const claimedByUid = msg.claimedByUid;
        if (claimedByUid !== identity.accountUid && identity.role !== 'dm') {
          return send(ws, { type: 'error', message: 'Only the DM can create a claim on someone else\'s behalf' });
        }
        const result = createLootClaim(db, identity.campaignId, msg.claimId, claimedByUid, msg.claimedByUsername);
        send(ws, { type: 'loot_claim_result', claimId: msg.claimId, ...result });
        // Matches the original's two listener roles exactly: the winning player needs to know
        // they won (loot_claim_result above already tells THEM, whether they won or not), and
        // the DM needs to know a claim happened at all so their roster can mark it claimed —
        // regardless of whether the DM was the one who sent this message. No one else is
        // notified, because no one else's listener in the original did anything in response
        // (a losing OTHER player's own claimedBy !== mp.uid check was always a no-op for them).
        if (identity.role !== 'dm') {
          const dmWs = findDmConnection(identity.campaignId);
          if (dmWs) send(dmWs, { type: 'loot_claim_update', claimId: msg.claimId, claimedByUid: result.claimedByUid, claimedByUsername: result.claimedByUsername });
        }
        return;
      }

      // Phase 3 of the mechanics rebuild. Wholesale-replace, same shape as push_battlefield —
      // roster entries are stored BARE (see the module comment's combat_state_update entry); the
      // enriched view with live PC ac/hp gets built fresh by buildCombatRosterView whenever it's
      // actually sent out, never stored, so a PC's HP can never go stale in the persisted roster.
      if (msg.type === 'push_combat_state') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can push combat state' });
        const roster = Array.isArray(msg.roster) ? msg.roster : [];
        const existing = loadSubsystemState(db, identity.campaignId, 'combat') || { log: [] };
        saveSubsystemState(db, identity.campaignId, 'combat', {
          active: !!msg.active, roundNumber: Number(msg.roundNumber) || 0, roster, log: existing.log || [],
        });
        // No separate ack: unlike push_battlefield (broadcastToPlayers, which EXCLUDES the DM,
        // hence needing push_battlefield_ack so the DM knows their own push landed),
        // broadcastToRoom reaches every connection including the sender — same reasoning
        // restock_merchant already uses to skip a redundant ack.
        broadcastToRoom(identity.campaignId, { type: 'combat_state_update', ...buildCombatRosterView(identity.campaignId) });
        return;
      }

      // Phase 3 of the mechanics rebuild. NOT DM-only — either side may trigger their own PC's
      // attack, matching the plan's "auto-resolve, no forced manual DM Apply click" decision. The
      // server resolves the roll itself (src/engine/combat/attack.js's resolveAttack) using its
      // own copy of both combatants' state — never a client-supplied roll — closing the old app's
      // unvalidated-client-computed-roll gap documented in the rebuild plan's audit.
      if (msg.type === 'combat_attack') {
        const combat = loadSubsystemState(db, identity.campaignId, 'combat');
        if (!combat) return send(ws, { type: 'error', message: 'No combat in progress' });
        const roster = combat.roster || [];
        const attackerEntry = roster.find(e => e.id === msg.attackerId);
        const targetEntry = roster.find(e => e.id === msg.targetId);
        if (!attackerEntry || !targetEntry) return send(ws, { type: 'error', message: 'Unknown attacker or target' });
        const attackerCombatant = combatCombatantFor(identity.campaignId, attackerEntry);
        const targetCombatant = combatCombatantFor(identity.campaignId, targetEntry);
        if (!attackerCombatant || !targetCombatant) return send(ws, { type: 'error', message: 'Could not resolve attacker or target' });

        const result = resolveAttack({
          attacker: attackerCombatant.attacker, target: targetCombatant.target, weaponOrAction: attackerCombatant.action,
        });
        const newHp = Math.max(0, targetCombatant.currentHp - (result.damage?.total ?? 0));
        if (targetEntry.kind === 'pc') {
          upsertCharacter(db, identity.campaignId, targetEntry.accountUid, { currentHp: newHp });
        } else {
          targetEntry.currentHp = newHp;
        }

        const logLine = result.isHit
          ? `${attackerEntry.name} attacks ${targetEntry.name}: ${result.outcome} for ${result.damage.total} ${result.damageType || ''}`.trim()
          : `${attackerEntry.name} attacks ${targetEntry.name}: ${result.outcome}`;
        const log = [...(combat.log || []), { message: logLine, result }].slice(-50);
        saveSubsystemState(db, identity.campaignId, 'combat', { active: !!combat.active, roundNumber: combat.roundNumber || 0, roster, log });
        broadcastToRoom(identity.campaignId, { type: 'combat_state_update', ...buildCombatRosterView(identity.campaignId) });
        return;
      }

      if (msg.type === 'push_battlefield') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can push battlefield state' });
        const battleRoster = filterBattleRosterForPlayers(msg.battleRoster);
        const battleLog = (msg.battleLog || []).slice(-50);
        // Read-modify-write on the same subsystem row push_battle_map also writes to, so
        // whichever pushes last doesn't clobber the other's fields, and reconnect catch-up
        // (below) only needs one read to hand a rejoining player everything at once.
        const existing = loadSubsystemState(db, identity.campaignId, 'battlefield_broadcast') || {};
        saveSubsystemState(db, identity.campaignId, 'battlefield_broadcast', { ...existing, battleRoster, battleLog });
        broadcastToPlayers(identity.campaignId, { type: 'battlefield_update', battleRoster, battleLog });
        send(ws, { type: 'push_battlefield_ack' });
        return;
      }

      // The DM's chosen battle map + token positions -- a separate message from push_battlefield
      // (roster/HP/loot) since it changes on a completely different rhythm (picking a map, or
      // dragging a token) and has nothing sensitive to filter out for players, unlike loot.
      if (msg.type === 'push_battle_map') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can update the battle map' });
        const activeBattleMap = msg.activeBattleMap || null;
        const battleMapTokens = Array.isArray(msg.battleMapTokens) ? msg.battleMapTokens : [];
        const existing = loadSubsystemState(db, identity.campaignId, 'battlefield_broadcast') || {};
        saveSubsystemState(db, identity.campaignId, 'battlefield_broadcast', { ...existing, activeBattleMap, battleMapTokens });
        broadcastToPlayers(identity.campaignId, { type: 'battle_map_update', activeBattleMap, battleMapTokens });
        send(ws, { type: 'push_battle_map_ack' });
        return;
      }

      if (msg.type === 'push_puzzle_log') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can push the puzzle log' });
        const puzzleLog = msg.puzzleLog || [];
        saveSubsystemState(db, identity.campaignId, 'puzzle_log_broadcast', { puzzleLog });
        broadcastToPlayers(identity.campaignId, { type: 'puzzle_log_update', puzzleLog });
        send(ws, { type: 'push_puzzle_log_ack' });
        return;
      }

      if (msg.type === 'push_gambling_state') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can push gambling state' });
        const state = msg.state || { game: null, table: null };
        saveSubsystemState(db, identity.campaignId, 'gambling', state);
        broadcastToPlayers(identity.campaignId, { type: 'gambling_state_update', state });
        send(ws, { type: 'push_gambling_state_ack' });
        return;
      }

      if (msg.type === 'submit_gambling_action') {
        // No role check beyond "must be identified" — any connected account (a player, or the DM
        // testing their own table) may submit an action; the DM's own client is the authority on
        // whether it's actually legal (matches applyGamblingAction's own no-op-if-illegal shape).
        const dmWs = findDmConnection(identity.campaignId);
        if (dmWs) {
          send(dmWs, {
            type: 'gambling_action_list',
            actions: [{ id: generateId(), ...msg.action, playerUid: identity.accountUid, playerUsername: identity.username }],
          });
        }
        // See the module comment above: no persisted queue, so there's nothing to catch up on if
        // the DM isn't connected right now — this ack only confirms the message was received and
        // handed off (or dropped, if no dealer is live), not that it was actually applied.
        send(ws, { type: 'gambling_action_submitted' });
        return;
      }

      if (msg.type === 'buy_staple') {
        // Any connected account (a player, or the DM buying/testing) may attempt a purchase —
        // the arbitration below is what actually decides it, the same "no role check needed
        // because the server is the real gatekeeper" shape create_loot_claim already uses.
        const merchantKey = msg.merchantKey;
        const index = Number(msg.index);
        const maxStock = Array.isArray(msg.maxStock) ? msg.maxStock : [];
        if (!merchantKey || !Number.isInteger(index) || index < 0) {
          return send(ws, { type: 'error', message: 'Invalid buy_staple request' });
        }
        const stockState = loadSubsystemState(db, identity.campaignId, 'merchant_stock') || {};
        // Lazily seeded from the CLIENT-supplied maxStock the first time this merchant is ever
        // bought from in this campaign — safe because MERCHANTS[key].staples' stock numbers are
        // static content identical for every client, not a secret the server needs to own
        // independently (same reasoning loot claims already lean on: the server only needs to
        // arbitrate the race, not know what the item even is).
        if (!stockState[merchantKey]) stockState[merchantKey] = [...maxStock];
        // Widen (never shrink) if the merchant's own staple list has grown since this campaign's
        // stock was first seeded, so an older campaign doesn't stay permanently missing newer
        // staples added to MERCHANTS later.
        while (stockState[merchantKey].length < maxStock.length) {
          stockState[merchantKey].push(maxStock[stockState[merchantKey].length]);
        }
        const remaining = stockState[merchantKey][index];
        const bought = typeof remaining === 'number' && remaining > 0;
        if (bought) stockState[merchantKey][index] = remaining - 1;
        // Persisted either way — even a rejected buy may have just lazily seeded this merchant's
        // stock for the very first time (see above), and that seed needs to stick around for
        // catch-up even though this particular index didn't move.
        saveSubsystemState(db, identity.campaignId, 'merchant_stock', stockState);
        send(ws, { type: 'buy_staple_result', merchantKey, index, bought });
        // Broadcast the merchant's full current array (not just this one index) to EVERY
        // connection, buyer included — one source of truth every client's own
        // merchantStapleStock[merchantKey] gets overwritten from, so nothing can drift. Only on
        // an actual change: a rejected purchase already tells the buyer via buy_staple_result
        // alone, and broadcasting an unchanged array on every losing attempt would mean a hot
        // contest over one popular item spams the whole room with no-op updates.
        if (bought) broadcastToRoom(identity.campaignId, { type: 'merchant_stock_update', merchantKey, remaining: stockState[merchantKey] });
        return;
      }

      if (msg.type === 'restock_merchant') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can restock a merchant' });
        const merchantKey = msg.merchantKey;
        const maxStock = Array.isArray(msg.maxStock) ? msg.maxStock : [];
        if (!merchantKey) return send(ws, { type: 'error', message: 'Invalid restock_merchant request' });
        const stockState = loadSubsystemState(db, identity.campaignId, 'merchant_stock') || {};
        stockState[merchantKey] = [...maxStock];
        saveSubsystemState(db, identity.campaignId, 'merchant_stock', stockState);
        broadcastToRoom(identity.campaignId, { type: 'merchant_stock_update', merchantKey, remaining: stockState[merchantKey] });
        return;
      }

      if (msg.type === 'submit_attack_request') {
        // Any connected player may submit their own attack — matching submitBattlefieldAttack's
        // own lack of a role check (any authenticated user could create one; it's always their
        // own uid/username the server stamps on it here, same as the original spreading
        // {...attack, playerUid: mp.uid, playerUsername: mp.username}).
        const request = createAttackRequest(db, identity.campaignId, identity.accountUid, identity.username, msg.attack);
        send(ws, { type: 'attack_request_submitted', requestId: request.id });
        const dmWs = findDmConnection(identity.campaignId);
        // Full current list, not a diff — matching startAttackRequestListener's own "hands the
        // main file the full current list of pending requests on every change" behavior.
        if (dmWs) send(dmWs, { type: 'attack_request_list', requests: listAttackRequests(db, identity.campaignId) });
        return;
      }

      if (msg.type === 'resolve_attack_request') {
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can resolve attack requests' });
        deleteAttackRequest(db, identity.campaignId, msg.requestId);
        send(ws, { type: 'attack_request_resolved', requestId: msg.requestId });
        send(ws, { type: 'attack_request_list', requests: listAttackRequests(db, identity.campaignId) });
        return;
      }

      if (msg.type === 'kick_player') {
        // Phase 6f. Matches the original removePlayer's own scope exactly: deletes this
        // campaign's character/inventory progress for the target, nothing about their identity
        // (there's no separate login to revoke in this identity model — see deletePlayerState's
        // own comment) — they can rejoin fresh with the same device uid and campaign code any
        // time, a known, deliberately-simple limitation carried forward from the original.
        if (identity.role !== 'dm') return send(ws, { type: 'error', message: 'Only the DM can remove a player.' });
        const targetUid = msg.targetUid;
        if (targetUid === identity.accountUid) return send(ws, { type: 'error', message: "You can't remove yourself." });
        deletePlayerState(db, identity.campaignId, targetUid);
        const room = roomFor(identity.campaignId);
        const target = room.get(targetUid);
        if (target) {
          // Told explicitly (not just disconnected) so their client shows a real reason instead
          // of silently reconnecting and looking like nothing happened — same spirit as the
          // Phase 6c displaced-connection fix above.
          send(target.ws, { type: 'kicked' });
          target.ws.close();
          room.delete(targetUid);
        }
        send(ws, { type: 'kick_ack', targetUid });
        broadcastRoster(identity.campaignId);
        return;
      }

      send(ws, { type: 'error', message: `Unknown message type "${msg.type}"` });
    });

    ws.on('close', () => {
      if (identity) {
        const room = rooms.get(identity.campaignId);
        if (room && room.get(identity.accountUid)?.ws === ws) {
          const wasPlayer = identity.role !== 'dm';
          room.delete(identity.accountUid);
          // Phase 5d: a disconnected player should drop off the DM's live roster.
          if (wasPlayer) broadcastRoster(identity.campaignId);
        }
      }
    });
  });

  // Keepalive: a WebSocket with no application traffic for a while (a player just idling on a
  // tab, doing nothing that pushes state) looks identical, on the wire, to a dead connection — and
  // routers/mobile carriers commonly drop an "idle" NAT/firewall mapping after a timeout with no
  // FIN and no error either side ever sees, until the next real message attempts to use it. That
  // silent death is exactly what showed up as a real bug report: a player on the DM's LAN seeing
  // "reconnecting…" fire over and over, each reconnect succeeding just long enough to go idle
  // again before the underlying network path drops it once more. A periodic ping keeps the
  // connection's traffic pattern alive so those idle timeouts never trigger, and doubles as a
  // faster way to notice a connection that's actually gone (missed two pongs in a row) than
  // waiting on the OS's own TCP-level timeout, which can take minutes.
  const HEARTBEAT_INTERVAL_MS = 25000;
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  httpServer.on('close', () => clearInterval(heartbeat));

  return wss;
}
