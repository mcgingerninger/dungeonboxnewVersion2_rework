// Phase 2 data-access layer — see db/schema.js for the schema itself and the reasoning behind
// its shape, and docs/ARCHITECTURE.md for how this fits into the migration as a whole.
//
// Uses node:sqlite (built into Node.js — see docs/ARCHITECTURE.md for why this was chosen over
// an npm package like better-sqlite3). Still marked experimental by Node itself as of this
// writing; noted as a real risk in the Phase 2 report, not glossed over.
//
// Not wired into the live browser app in this phase — this module only runs under Node (the
// future Phase 3 server, and this phase's own regression tests). openDatabase(':memory:') is
// the pattern the tests use; a real deployment would pass a file path instead.

import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL, SUBSYSTEMS } from './schema.js';

export function openDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------- Campaigns ----------

// Same alphabet the original Firestore-era multiplayer-sync.js used for its room codes:
// visually-unambiguous (no 0/O, 1/I/L) since these get read aloud and typed by hand at the
// table. 5 characters from 32 symbols is ~33.5M combinations — collisions against the UNIQUE
// constraint are handled below by simply retrying, rather than needing a longer code up front.
const CAMPAIGN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCampaignCode(len = 5) {
  let out = '';
  for (let i = 0; i < len; i++) out += CAMPAIGN_CODE_ALPHABET[Math.floor(Math.random() * CAMPAIGN_CODE_ALPHABET.length)];
  return out;
}

export function createCampaign(db, name) {
  const insert = db.prepare('INSERT INTO campaigns (name, code) VALUES (?, ?)');
  // Collision retry rather than a pre-check-then-insert (which would race under concurrent
  // creates) — the UNIQUE constraint is the actual arbiter; a failed insert just means try again
  // with a fresh code. Effectively always succeeds on the first attempt at this code space size.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const info = insert.run(name, generateCampaignCode());
      return getCampaign(db, Number(info.lastInsertRowid));
    } catch (err) {
      if (!/UNIQUE constraint failed/.test(err.message) || attempt === 9) throw err;
    }
  }
}

export function getCampaign(db, id) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) || null;
}

// Case-insensitive: players type this by hand, and the original's own campaignCode.toUpperCase()
// normalization (see multiplayer-sync.js's signUpPlayer) is the precedent for not making case
// matter here either. Codes are always generated uppercase, but this matches lowercase input too.
export function getCampaignByCode(db, code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM campaigns WHERE code = ?').get(String(code).trim().toUpperCase()) || null;
}

export function listCampaigns(db) {
  return db.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all();
}

export function touchCampaign(db, id) {
  db.prepare("UPDATE campaigns SET updated_at = datetime('now') WHERE id = ?").run(id);
}

// ---------- Characters ----------
// `sheet` mirrors the shape of the relevant slice of the old localStorage blob: abilityScores
// ({str,dex,con,int,wis,cha}), level, skillProficiencies, skillExpertise, saveProficiencies,
// currentHp, maxHp, maxHpEffective, hitDieSize, ac, class, spellSlotsMax, spellSlotsUsed, traits.
// Every field is optional and falls back to the schema's column default, matching
// applyStateBlob's existing "only overwrite what's actually present" behavior rather than
// requiring a full sheet on every call.
const ABILITY_COLUMN = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

export function upsertCharacter(db, campaignId, accountUid, sheet = {}) {
  const existing = getCharacter(db, campaignId, accountUid);
  const abilityScores = sheet.abilityScores || {};
  const fields = {
    username: sheet.username,
    class: sheet.class,
    level: sheet.level,
    hit_die_size: sheet.hitDieSize,
    strength: abilityScores.str,
    dexterity: abilityScores.dex,
    constitution: abilityScores.con,
    intelligence: abilityScores.int,
    wisdom: abilityScores.wis,
    charisma: abilityScores.cha,
    current_hp: sheet.currentHp,
    max_hp: sheet.maxHp,
    max_hp_effective: sheet.maxHpEffective,
    ac: sheet.ac,
    skill_proficiencies: sheet.skillProficiencies ? JSON.stringify(sheet.skillProficiencies) : undefined,
    skill_expertise: sheet.skillExpertise ? JSON.stringify(sheet.skillExpertise) : undefined,
    save_proficiencies: sheet.saveProficiencies ? JSON.stringify(sheet.saveProficiencies) : undefined,
    spell_slots_max: sheet.spellSlotsMax ? JSON.stringify(sheet.spellSlotsMax) : undefined,
    spell_slots_used: sheet.spellSlotsUsed ? JSON.stringify(sheet.spellSlotsUsed) : undefined,
    traits: sheet.traits ? JSON.stringify(sheet.traits) : undefined,
  };
  if (existing) {
    const sets = [];
    const values = [];
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) { sets.push(`${col} = ?`); values.push(val); }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(existing.id);
      db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return getCharacterById(db, existing.id);
  }
  const cols = ['campaign_id', 'account_uid'];
  const placeholders = ['?', '?'];
  const values = [campaignId, accountUid ?? null];
  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined) { cols.push(col); placeholders.push('?'); values.push(val); }
  }
  const stmt = db.prepare(`INSERT INTO characters (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`);
  const info = stmt.run(...values);
  return getCharacterById(db, Number(info.lastInsertRowid));
}

function rowToSheet(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    accountUid: row.account_uid,
    username: row.username,
    class: row.class,
    level: row.level,
    hitDieSize: row.hit_die_size,
    abilityScores: {
      str: row.strength, dex: row.dexterity, con: row.constitution,
      int: row.intelligence, wis: row.wisdom, cha: row.charisma,
    },
    currentHp: row.current_hp,
    maxHp: row.max_hp,
    maxHpEffective: row.max_hp_effective,
    ac: row.ac,
    skillProficiencies: JSON.parse(row.skill_proficiencies),
    skillExpertise: JSON.parse(row.skill_expertise),
    saveProficiencies: JSON.parse(row.save_proficiencies),
    spellSlotsMax: JSON.parse(row.spell_slots_max),
    spellSlotsUsed: JSON.parse(row.spell_slots_used),
    traits: JSON.parse(row.traits),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCharacter(db, campaignId, accountUid) {
  const row = accountUid == null
    ? db.prepare('SELECT * FROM characters WHERE campaign_id = ? AND account_uid IS NULL').get(campaignId)
    : db.prepare('SELECT * FROM characters WHERE campaign_id = ? AND account_uid = ?').get(campaignId, accountUid);
  return rowToSheet(row);
}

export function getCharacterById(db, id) {
  return rowToSheet(db.prepare('SELECT * FROM characters WHERE id = ?').get(id));
}

export function listCharacters(db, campaignId) {
  return db.prepare('SELECT * FROM characters WHERE campaign_id = ?').all(campaignId).map(rowToSheet);
}

// ---------- Campaign state (subsystem blobs) ----------

function assertValidSubsystem(subsystem) {
  if (!SUBSYSTEMS[subsystem]) {
    throw new Error(`Unknown subsystem "${subsystem}" — must be one of: ${Object.keys(SUBSYSTEMS).join(', ')}`);
  }
}

export function saveSubsystemState(db, campaignId, subsystem, data) {
  assertValidSubsystem(subsystem);
  const json = JSON.stringify(data);
  db.prepare(`
    INSERT INTO campaign_state (campaign_id, subsystem, data)
    VALUES (?, ?, ?)
    ON CONFLICT(campaign_id, subsystem) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `).run(campaignId, subsystem, json);
}

export function loadSubsystemState(db, campaignId, subsystem) {
  assertValidSubsystem(subsystem);
  const row = db.prepare('SELECT data FROM campaign_state WHERE campaign_id = ? AND subsystem = ?').get(campaignId, subsystem);
  return row ? JSON.parse(row.data) : null;
}

export function loadAllSubsystemState(db, campaignId) {
  const rows = db.prepare('SELECT subsystem, data FROM campaign_state WHERE campaign_id = ?').all(campaignId);
  const out = {};
  rows.forEach(r => { out[r.subsystem] = JSON.parse(r.data); });
  return out;
}

// ---------- Player states (Phase 5a — see db/schema.js's comment on player_states) ----------

export function savePlayerState(db, campaignId, accountUid, state, rev) {
  const json = JSON.stringify(state);
  db.prepare(`
    INSERT INTO player_states (campaign_id, account_uid, state, rev)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(campaign_id, account_uid) DO UPDATE SET state = excluded.state, rev = excluded.rev, updated_at = datetime('now')
  `).run(campaignId, accountUid, json, rev || 0);
}

export function loadPlayerState(db, campaignId, accountUid) {
  const row = db.prepare('SELECT state, rev FROM player_states WHERE campaign_id = ? AND account_uid = ?').get(campaignId, accountUid);
  return row ? { state: JSON.parse(row.state), rev: row.rev } : null;
}

export function loadAllPlayerStates(db, campaignId) {
  const rows = db.prepare('SELECT account_uid, state, rev FROM player_states WHERE campaign_id = ?').all(campaignId);
  return rows.map(r => ({ accountUid: r.account_uid, state: JSON.parse(r.state), rev: r.rev }));
}

// Phase 6f: the DM removing a player from their campaign — deletes their character/inventory
// progress for THIS campaign, matching the original removePlayer's own scope exactly (their
// login/identity isn't a thing this app tracks at all in the room-code identity model, so there's
// nothing else to delete; they can rejoin fresh with the same device uid and the same campaign
// code any time, same "known limitation, kept deliberately simple" the original documented).
export function deletePlayerState(db, campaignId, accountUid) {
  db.prepare('DELETE FROM player_states WHERE campaign_id = ? AND account_uid = ?').run(campaignId, accountUid);
}

// ---------- Loot claims (Phase 5b — see db/schema.js's comment on loot_claims) ----------

// Attempts to create a claim; the UNIQUE(campaign_id, claim_id) constraint is what actually
// arbitrates the race — this function's job is just to translate "the INSERT itself failed
// because the row already exists" into a normal, non-exceptional return value rather than an
// error a caller has to unwrap. A constraint failure for any OTHER reason (there isn't one on
// this table today, but this file shouldn't assume that forever) still propagates as a real
// exception rather than being silently treated as "someone else claimed it."
export function createLootClaim(db, campaignId, claimId, claimedByUid, claimedByUsername) {
  try {
    db.prepare(`
      INSERT INTO loot_claims (campaign_id, claim_id, claimed_by_uid, claimed_by_username)
      VALUES (?, ?, ?, ?)
    `).run(campaignId, claimId, claimedByUid, claimedByUsername || null);
    return { won: true, claimedByUid, claimedByUsername: claimedByUsername || null };
  } catch (err) {
    if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message)) {
      const existing = getLootClaim(db, campaignId, claimId);
      return { won: false, claimedByUid: existing.claimedByUid, claimedByUsername: existing.claimedByUsername };
    }
    throw err;
  }
}

export function getLootClaim(db, campaignId, claimId) {
  const row = db.prepare('SELECT claimed_by_uid, claimed_by_username FROM loot_claims WHERE campaign_id = ? AND claim_id = ?').get(campaignId, claimId);
  return row ? { claimedByUid: row.claimed_by_uid, claimedByUsername: row.claimed_by_username } : null;
}

// ---------- Attack requests (Phase 5d — see db/schema.js's comment on attack_requests) ----------

function rowToAttackRequest(row) {
  return { id: row.id, playerUid: row.player_uid, playerUsername: row.player_username, attackData: JSON.parse(row.attack_data), createdAt: row.created_at };
}

export function createAttackRequest(db, campaignId, playerUid, playerUsername, attackData) {
  const info = db.prepare(`
    INSERT INTO attack_requests (campaign_id, player_uid, player_username, attack_data)
    VALUES (?, ?, ?, ?)
  `).run(campaignId, playerUid, playerUsername || null, JSON.stringify(attackData));
  return rowToAttackRequest(db.prepare('SELECT * FROM attack_requests WHERE id = ?').get(Number(info.lastInsertRowid)));
}

// Ordered oldest-first — a real, if simple, FIFO review queue for the DM rather than an
// unspecified order that could make requests appear to jump around between renders.
export function listAttackRequests(db, campaignId) {
  return db.prepare('SELECT * FROM attack_requests WHERE campaign_id = ? ORDER BY id ASC').all(campaignId).map(rowToAttackRequest);
}

// Returns whether a row actually existed to delete, so a caller (or test) can tell "resolved
// successfully" apart from "that request was already gone" rather than both looking identical.
export function deleteAttackRequest(db, campaignId, requestId) {
  const info = db.prepare('DELETE FROM attack_requests WHERE campaign_id = ? AND id = ?').run(campaignId, requestId);
  return info.changes > 0;
}
