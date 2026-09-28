// Phase 2 of the architecture migration (see docs/MIGRATION_PLAN.md, docs/ARCHITECTURE.md):
// SQLite schema, replacing the current app's single localStorage JSON blob
// (saveAppState/loadAppState/applyStateBlob in the monolithic HTML file) with durable,
// queryable storage. NOT wired into the live browser app yet — this phase is schema + access
// layer only, establishing what Phase 3's Node.js server will build on.
//
// Design approach: partial normalization, not a full relational redesign. The one piece of
// state that's genuinely relational and benefits from real columns — the character sheet — gets
// its own table with real columns (str/dex/con/etc, level, hp, ac...), matching
// game-engine.js's computeCharacterSheetFor inputs directly. Everything else the current app
// persists (inventory, battle roster/log, merchant state, mangler state, loot-rarity settings,
// timed effects, journey log, puzzle log, gambling state, bounties, claim-dedup lists) keeps its
// current JSON shape for now, but moves from one flat blob into `campaign_state` rows scoped by
// (campaign, subsystem) — a real improvement (each subsystem is independently readable/
// writable, no more read-modify-write-the-whole-blob for one small change) without speculatively
// inventing a large relational schema for data whose future query patterns aren't known yet.
// Each subsystem row is a natural seam for a later phase to peel out into its own fully
// normalized table, one at a time, without touching the others.

export const SCHEMA_SQL = `
-- 'code' is the human-shareable join code a DM reads aloud/types to their players (Phase 6b of
-- the migration -- see docs/ARCHITECTURE.md), replacing the room-code concept multiplayer-sync.js
-- used to get for free as a Firestore document id. Generated server-side at creation (see
-- database.js's createCampaign) from the same visually-unambiguous alphabet the original used
-- (no 0/O/1/I/L), since that reasoning -- read aloud and typed by hand at the table -- still
-- applies. UNIQUE rather than a separate lookup table; a table this small needs nothing more.
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per character. account_uid is the multiplayer identity (see multiplayer-sync.js's
-- own uid concept) and is NULL for solo/guest play, matching gamblingSelfUid()'s existing
-- 'solo' convention in spirit (a NULL account_uid IS the solo character for its campaign).
-- Column names match game-engine.js's ABILITY_NAMES full names (Strength, Dexterity, ...)
-- rather than the app's str/dex/con abbreviations, so the mapping to computeCharacterSheetFor's
-- abilityScores argument is unambiguous.
-- Phase 2 of the mechanics rebuild (see the approved rebuild plan) replaced the old freeform
-- 'hit_dice' TEXT label (e.g. "5d10" — display-only, nothing derived from it) with a structured
-- 'hit_die_size' (6/8/10/12, no class table) that src/engine/character/hp.js actually computes
-- max_hp from, alongside level and the Constitution modifier. max_hp/max_hp_effective/ac are
-- still stored columns (not computed on every read) but are meant to be written by that engine
-- computation, not typed in directly — enforced at the UI layer, same as before.
-- skill_expertise is separate from skill_proficiencies (double proficiency bonus vs. single).
-- spell_slots_max/spell_slots_used are per-level JSON maps ({"1":2,"2":1,...}), DM/player-set
-- directly rather than derived from a class table, matching how the prior app already modeled
-- spell slots. traits is a JSON array of {id, name, description, statMods:[{stat, value}]} —
-- structured with real mechanical effects (confirmed with the user), consumed by
-- computeDerivedSheet the same way item passive effects will consume their own statMods later.
-- speed is the character's BASE walking speed (traits can still add to it via a 'speed' statMod
-- at read time — see computeDerivedSheet's separate 'effectiveSpeed' output — but the stored
-- column itself is always just the raw base, never overwritten with a trait-inflated total, to
-- avoid compounding on every save). size/alignment are plain descriptive fields (size also
-- doubles as the eventual grid-footprint value for a battle map, alignment is flavor/roleplay
-- only — neither is computed). proficiency_bonus is a stored, directly editable field (not
-- purely level-derived) — confirmed with the user, same "DM/player can adjust it directly"
-- philosophy as spell slots; src/engine/character/character-sheet.js falls back to the standard
-- level-derived value only when this column is genuinely absent (e.g. an ad-hoc engine call that
-- didn't come from the DB), never overriding an explicit value.
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_uid TEXT,
  username TEXT,
  class TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  hit_die_size INTEGER NOT NULL DEFAULT 8,
  proficiency_bonus INTEGER NOT NULL DEFAULT 2,
  speed INTEGER NOT NULL DEFAULT 30,
  size TEXT NOT NULL DEFAULT 'Medium',
  alignment TEXT NOT NULL DEFAULT '',
  strength INTEGER NOT NULL DEFAULT 10,
  dexterity INTEGER NOT NULL DEFAULT 10,
  constitution INTEGER NOT NULL DEFAULT 10,
  intelligence INTEGER NOT NULL DEFAULT 10,
  wisdom INTEGER NOT NULL DEFAULT 10,
  charisma INTEGER NOT NULL DEFAULT 10,
  current_hp INTEGER NOT NULL DEFAULT 10,
  max_hp INTEGER NOT NULL DEFAULT 10,
  max_hp_effective INTEGER NOT NULL DEFAULT 10,
  ac INTEGER NOT NULL DEFAULT 10,
  skill_proficiencies TEXT NOT NULL DEFAULT '[]',
  skill_expertise TEXT NOT NULL DEFAULT '[]',
  save_proficiencies TEXT NOT NULL DEFAULT '[]',
  spell_slots_max TEXT NOT NULL DEFAULT '{}',
  spell_slots_used TEXT NOT NULL DEFAULT '{}',
  traits TEXT NOT NULL DEFAULT '[]',
  -- Phase 6 of the mechanics rebuild (see the approved rebuild plan): real inventory/equip state,
  -- added directly to this table rather than a campaign_state bucket or the WebSocket-only
  -- player_states table — both of those exist for other reasons (campaign-wide DM settings /
  -- Firestore-mirroring live sync state) and neither is "this one character's owned items," which
  -- belongs alongside its other mechanical columns (traits, spell slots) on this same row.
  -- inventory is a JSON array of owned item INSTANCES: [{instanceId, itemId, usesLeft?}, ...] —
  -- instanceId (not itemId) is what equipped_slots below points at, since a character can own two
  -- copies of the same catalog item (two Potions of Healing) with independently tracked usesLeft.
  -- Equipping never removes an entry from this array — it's the character's full owned list;
  -- equipped_slots is just which instanceId currently occupies which slot.
  inventory TEXT NOT NULL DEFAULT '[]',
  -- JSON object { [slotId]: instanceId | null } — slotId is one of src/engine/character/
  -- equipment.js's EQUIPMENT_SLOTS ids (weapon1/weapon2/armor/shield/helmet/handwear/boots/
  -- leggings/facewear/cloak/beltwaist), a scoped-down subset of the old app's real 24-slot
  -- SLOT_CATEGORY (dungeon_loot_wheel_v102_spell_details.html) — ring/amulet/charm/limb/companion
  -- slots return once wondrous/quest items exist to occupy them (still deferred, see item-schema.js).
  equipped_slots TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, account_uid)
);

-- Generic per-subsystem state bucket. 'subsystem' is one of: inventory, battle, merchant,
-- bounties, mangler, loot_settings, effects, claims, journey, puzzle_log, gambling — see
-- docs/ARCHITECTURE.md for the exact field-by-field mapping from the old localStorage blob's
-- top-level keys to these subsystem buckets.
CREATE TABLE IF NOT EXISTS campaign_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subsystem TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, subsystem)
);

-- Added in Phase 5a (see docs/ARCHITECTURE.md) for the WebSocket sync layer. Unlike
-- campaign_state (one row per campaign+subsystem, meant for campaign-wide DM settings), a
-- player's full save-state blob (inventory, equipped gear, generated items, etc.) is inherently
-- per-PLAYER, not per-campaign — this mirrors exactly what the original Firestore model already
-- did (rooms/{code}/players/{uid} held one player's entire state), which campaign_state alone
-- had no way to represent since Phase 2 only ever needed to model a single DM's own data.
-- rev is a client-supplied monotonic counter, same purpose as the original's ordering guard,
-- but WebSocket's server-mediated broadcast means the SELF-echo half of the original problem
-- (Firestore's onSnapshot always echoing a client's own writes back to it) doesn't exist here —
-- the server simply never sends a state_update back to the connection that sent the push. This
-- column still guards against genuinely out-of-order delivery of rapid successive pushes.
CREATE TABLE IF NOT EXISTS player_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_uid TEXT NOT NULL,
  state TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, account_uid)
);

-- Added in Phase 5b (see docs/ARCHITECTURE.md) for real-time loot-claim arbitration. The
-- original design relied on Firestore's create-vs-update security rules: a claim doc write at a
-- deterministic id (monsterUid_itemId) either succeeds as a "create" (first writer) or fails as
-- a denied "update" (everyone after) — true first-write-wins with zero custom arbitration code.
-- The UNIQUE constraint below is the direct SQL equivalent of that same guarantee: an INSERT for
-- a (campaign_id, claim_id) pair that already exists fails outright rather than overwriting, so
-- database.js's createLootClaim can distinguish "you won" from "someone already claimed this"
-- by whether the INSERT itself succeeded — no read-then-write race window, same as the original.
-- Deliberately does NOT store the actual item data (see the module comment in
-- server/websocket.js) — only who won the race for a given claim id, matching the original's own
-- separation between claim arbitration and item delivery.
CREATE TABLE IF NOT EXISTS loot_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL,
  claimed_by_uid TEXT NOT NULL,
  claimed_by_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, claim_id)
);

-- Added in Phase 5d (see docs/ARCHITECTURE.md) for the DM-review attack-request queue
-- (submitBattlefieldAttack/startAttackRequestListener/resolveAttackRequest in the original).
-- Unlike loot_claims, deliberately has NO uniqueness constraint — multiple pending requests
-- coexisting normally is the whole point (several players can each have an attack awaiting
-- review at once), so there's nothing to arbitrate here, just a queue. attack_data holds the
-- attack payload verbatim as JSON (to-hit, damage, target, etc.) exactly as the original passed
-- it through unopinionated (see submitBattlefieldAttack's own "...attack" spread) — this table
-- doesn't need to understand its shape, only store and list it.
CREATE TABLE IF NOT EXISTS attack_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_uid TEXT NOT NULL,
  player_username TEXT,
  attack_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_state_campaign ON campaign_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_player_states_campaign ON player_states(campaign_id);
CREATE INDEX IF NOT EXISTS idx_loot_claims_campaign ON loot_claims(campaign_id);
CREATE INDEX IF NOT EXISTS idx_attack_requests_campaign ON attack_requests(campaign_id);
`;

// Every valid subsystem name, and the exact top-level saveAppState() field(s) each one replaces
// — kept here (not just in a comment) so database.js and its tests can validate against a single
// source of truth rather than a hardcoded string list duplicated in multiple places.
export const SUBSYSTEMS = {
  inventory:     ['inventoryGrid', 'inventoryPlacements', 'inventoryPlacementCounter', 'savedGeneratedItems', 'playerSlots', 'tokenSlotOverrides', 'recentlyLooted', 'savedLoadouts'],
  battle:        ['battleRoster', 'battleLog', 'battleUidCounter', '_battleActionTextMap', '_battleActionCounter'],
  merchant:      ['currentMerchant', 'merchantDailyItems', 'merchantDailySold', 'merchantStapleStock', 'merchantTills'],
  bounties:      ['activeBounties', 'bountyCounter'],
  mangler:       ['manglerFinishedWork', 'manglerPartKey', 'manglerItemKey', 'manglerFocus'],
  loot_settings: ['combatLootSettings', 'chestLootSettings', 'corpseLootSettings', 'modWeights', 'fleshModWeights'],
  effects:       ['activeTimedEffects', 'activeEffectCounter'],
  claims:        ['appliedLootClaimIds', 'appliedGamblingPayoutIds'],
  journey:       ['journeySetting', 'journeyLog', 'journeyLogCounter', 'journeySettingWeights'],
  puzzle_log:    ['puzzleLog'],
  gambling:      ['gamblingState'],
  // Added in Phase 5c (see docs/ARCHITECTURE.md) for the DM-published, player-facing broadcast
  // of combat/puzzle state — deliberately separate from the 'battle'/'puzzle_log' subsystems
  // above, which hold the DM's own PRIVATE full save-state blob (matching saveAppState's raw
  // battleRoster/puzzleLog fields verbatim). battlefield_broadcast specifically holds the
  // loot-visibility-FILTERED version players are actually allowed to see (see
  // server/websocket.js's push_battlefield handler) — conflating the two under one name would
  // either leak DM-only data to players or silently drop the DM's own unfiltered save data.
  battlefield_broadcast: ['battleRoster', 'battleLog'],
  puzzle_log_broadcast:  ['puzzleLog'],
  // Added post-Phase-6c for shared, campaign-wide merchant staple stock (see
  // docs/ARCHITECTURE.md's "Store Purchase Sync" section). Deliberately separate from the
  // 'merchant' subsystem above, which is per-player field-mapping documentation for the old
  // localStorage blob (currentMerchant/merchantTills/etc. are each player's own local view) —
  // this one holds ONE shared, arbitrated remaining-stock array per merchant key
  // ({ [merchantKey]: [remainingForStaple0, remainingForStaple1, ...] }), the actual source of
  // truth every connected client's own merchantStapleStock[key] gets synced against. Daily
  // wares are deliberately NOT included — each merchant's 5 daily items are randomly rolled per
  // account by design, with no shared catalog to arbitrate against, so syncing "index 2 sold"
  // across two independently-rolled daily lists would be meaningless. Staples are safe to
  // arbitrate because MERCHANTS[key].staples is static, identical content for every client.
  // No old blob field to map from — this is new, shared state with no per-player equivalent.
  // Non-empty so assertValidSubsystem's truthiness check (database.js) accepts the key; the
  // array's contents aren't otherwise meaningful, unlike every other entry above.
  merchant_stock: ['(no legacy field — new shared state)'],
  // Phase 3 of the mechanics rebuild (see the approved rebuild plan): shared combat/encounter
  // state, replacing the old app's client-memory-only battleRoster (lost on refresh) with a real
  // persisted row, following this same subsystem-bucket pattern rather than a dedicated table —
  // the shape isn't proven stable yet. { active, roundNumber, roster, log }. A roster entry is
  // either { id, kind:'pc', name, accountUid } (AC/HP always read live from the characters table
  // via accountUid, never duplicated here) or { id, kind:'monster', name, ac, currentHp, maxHp,
  // attackBonus, damageDice, damageType } (fully self-contained — no monster-stat-block system
  // exists yet; that's Phase 7.2's job). No old blob field to map from.
  combat: ['(no legacy field — new mechanics-rebuild state)'],
};
