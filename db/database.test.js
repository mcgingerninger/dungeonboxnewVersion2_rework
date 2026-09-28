// Regression tests for the Phase 2 SQLite schema + access layer. Run with: node --test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDatabase, createCampaign, getCampaign, getCampaignByCode, listCampaigns, touchCampaign,
  upsertCharacter, getCharacter, getCharacterById, listCharacters,
  saveSubsystemState, loadSubsystemState, loadAllSubsystemState,
  savePlayerState, loadPlayerState, loadAllPlayerStates,
  createLootClaim, getLootClaim,
  createAttackRequest, listAttackRequests, deleteAttackRequest,
} from './database.js';
import { SUBSYSTEMS } from './schema.js';

describe('campaigns', () => {
  test('create, get, list', () => {
    const db = openDatabase(':memory:');
    const c1 = createCampaign(db, 'Curse of the Crimson Throne');
    assert.equal(c1.name, 'Curse of the Crimson Throne');
    assert.ok(c1.id > 0);
    const fetched = getCampaign(db, c1.id);
    assert.equal(fetched.id, c1.id);
    const c2 = createCampaign(db, 'A second campaign');
    assert.equal(listCampaigns(db).length, 2);
  });

  test('get returns null for a nonexistent campaign', () => {
    const db = openDatabase(':memory:');
    assert.equal(getCampaign(db, 999), null);
  });

  test('createCampaign generates a unique, unambiguous-alphabet join code', () => {
    const db = openDatabase(':memory:');
    const c = createCampaign(db, 'Test');
    assert.match(c.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  test('two campaigns never collide on code (100 created, all unique)', () => {
    const db = openDatabase(':memory:');
    const codes = new Set();
    for (let i = 0; i < 100; i++) codes.add(createCampaign(db, `Campaign ${i}`).code);
    assert.equal(codes.size, 100);
  });

  test('getCampaignByCode finds the campaign, case-insensitively', () => {
    const db = openDatabase(':memory:');
    const c = createCampaign(db, 'Test');
    assert.deepEqual(getCampaignByCode(db, c.code), c);
    assert.deepEqual(getCampaignByCode(db, c.code.toLowerCase()), c);
  });

  test('getCampaignByCode returns null for an unknown or empty code', () => {
    const db = openDatabase(':memory:');
    assert.equal(getCampaignByCode(db, 'ZZZZZ'), null);
    assert.equal(getCampaignByCode(db, ''), null);
    assert.equal(getCampaignByCode(db, null), null);
  });

  test('touchCampaign updates updated_at', () => {
    const db = openDatabase(':memory:');
    const c = createCampaign(db, 'Test');
    const before = getCampaign(db, c.id).updated_at;
    touchCampaign(db, c.id);
    // Same-second updates won't necessarily produce a different string, but the call must not
    // throw and the row must still exist with the same id — the real regression this guards is
    // "does the UPDATE statement even run without error."
    const after = getCampaign(db, c.id);
    assert.equal(after.id, c.id);
    assert.ok(after.updated_at >= before);
  });
});

describe('characters', () => {
  test('upsertCharacter creates a new character with full sheet data', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const sheet = upsertCharacter(db, campaign.id, 'uid-1', {
      username: 'Kaelen', class: 'Ranger', level: 5, hitDieSize: 10,
      abilityScores: { str: 14, dex: 16, con: 12, int: 10, wis: 13, cha: 8 },
      currentHp: 38, maxHp: 42, maxHpEffective: 43, ac: 15,
      skillProficiencies: ['Stealth', 'Survival'], skillExpertise: ['Stealth'],
      saveProficiencies: ['dex', 'str'],
      spellSlotsMax: { 1: 4, 2: 3 }, spellSlotsUsed: { 1: 1 },
      traits: [{ id: 'darkvision', name: 'Darkvision', description: 'See in dim light as if bright.', statMods: [] }],
    });
    assert.equal(sheet.username, 'Kaelen');
    assert.equal(sheet.level, 5);
    assert.equal(sheet.hitDieSize, 10);
    assert.deepEqual(sheet.abilityScores, { str: 14, dex: 16, con: 12, int: 10, wis: 13, cha: 8 });
    assert.equal(sheet.maxHpEffective, 43);
    assert.deepEqual(sheet.skillProficiencies, ['Stealth', 'Survival']);
    assert.deepEqual(sheet.skillExpertise, ['Stealth']);
    assert.deepEqual(sheet.spellSlotsMax, { 1: 4, 2: 3 });
    assert.equal(sheet.traits[0].name, 'Darkvision');
  });

  test('upsertCharacter on an existing character only overwrites the fields provided', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    upsertCharacter(db, campaign.id, 'uid-1', {
      username: 'Kaelen', level: 5, abilityScores: { str: 14, dex: 16, con: 12, int: 10, wis: 13, cha: 8 }, ac: 15,
    });
    // Partial update: only bumping level and current HP. Everything else (username, ability
    // scores, AC) must survive unchanged — matching applyStateBlob's existing "field-by-field,
    // only overwrite what's present" behavior in the current localStorage blob approach.
    const updated = upsertCharacter(db, campaign.id, 'uid-1', { level: 6, currentHp: 30 });
    assert.equal(updated.level, 6);
    assert.equal(updated.currentHp, 30);
    assert.equal(updated.username, 'Kaelen');
    assert.equal(updated.ac, 15);
    assert.deepEqual(updated.abilityScores.str, 14);
  });

  test('one character per (campaign, account_uid); a null account_uid is the solo/guest slot', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    upsertCharacter(db, campaign.id, null, { username: 'Solo Player' });
    const solo = getCharacter(db, campaign.id, null);
    assert.equal(solo.username, 'Solo Player');
    assert.equal(solo.accountUid, null);
  });

  test('listCharacters returns every character in a campaign', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    upsertCharacter(db, campaign.id, 'uid-1', { username: 'A' });
    upsertCharacter(db, campaign.id, 'uid-2', { username: 'B' });
    const list = listCharacters(db, campaign.id);
    assert.equal(list.length, 2);
    assert.deepEqual(list.map(c => c.username).sort(), ['A', 'B']);
  });

  test('getCharacter returns null when no character exists yet for that account', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.equal(getCharacter(db, campaign.id, 'nobody'), null);
  });
});

describe('campaign_state (subsystem blobs)', () => {
  test('save and load round-trips arbitrary JSON per subsystem', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const inventoryData = { inventoryGrid: [[null, 'itemKey1'], [null, null]], playerSlots: { weapon1: 'itemKey1' } };
    saveSubsystemState(db, campaign.id, 'inventory', inventoryData);
    assert.deepEqual(loadSubsystemState(db, campaign.id, 'inventory'), inventoryData);
  });

  test('saving the same subsystem twice overwrites rather than duplicating', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    saveSubsystemState(db, campaign.id, 'gambling', { game: 'roulette', table: { phase: 'betting' } });
    saveSubsystemState(db, campaign.id, 'gambling', { game: 'blackjack', table: { phase: 'playing' } });
    const loaded = loadSubsystemState(db, campaign.id, 'gambling');
    assert.equal(loaded.game, 'blackjack');
  });

  test('loadSubsystemState returns null for a subsystem never saved', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.equal(loadSubsystemState(db, campaign.id, 'journey'), null);
  });

  test('subsystem state is scoped per campaign — two campaigns never see each other\'s data', () => {
    const db = openDatabase(':memory:');
    const c1 = createCampaign(db, 'Campaign 1');
    const c2 = createCampaign(db, 'Campaign 2');
    saveSubsystemState(db, c1.id, 'puzzle_log', ['riddle A']);
    saveSubsystemState(db, c2.id, 'puzzle_log', ['riddle B']);
    assert.deepEqual(loadSubsystemState(db, c1.id, 'puzzle_log'), ['riddle A']);
    assert.deepEqual(loadSubsystemState(db, c2.id, 'puzzle_log'), ['riddle B']);
  });

  test('loadAllSubsystemState returns every saved subsystem for a campaign, keyed by name', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    saveSubsystemState(db, campaign.id, 'journey', { journeySetting: 'countryside', journeyLog: [] });
    saveSubsystemState(db, campaign.id, 'bounties', { activeBounties: [], bountyCounter: 0 });
    const all = loadAllSubsystemState(db, campaign.id);
    assert.deepEqual(Object.keys(all).sort(), ['bounties', 'journey']);
    assert.equal(all.journey.journeySetting, 'countryside');
  });

  test('rejects an unrecognized subsystem name rather than silently accepting typos', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.throws(() => saveSubsystemState(db, campaign.id, 'not_a_real_subsystem', {}), /Unknown subsystem/);
    assert.throws(() => loadSubsystemState(db, campaign.id, 'not_a_real_subsystem'), /Unknown subsystem/);
  });

  test('every subsystem named in the old saveAppState() blob has a home here', () => {
    // This is the actual coverage check against the field-by-field mapping documented in
    // db/schema.js and docs/ARCHITECTURE.md — not just "does the code run," but "does every
    // field the current app persists have somewhere to go." battlefield_broadcast and
    // puzzle_log_broadcast (Phase 5c) aren't fields from the old blob at all — they're the
    // DM-published, player-facing broadcast versions of battle/puzzle_log, deliberately kept
    // separate (see db/schema.js's comment) — included here since this is the source-of-truth
    // list check for SUBSYSTEMS as a whole, not just the original blob's coverage. Same for
    // merchant_stock (post-6c) — the shared, arbitrated staple-stock state, no old blob field.
    const expectedSubsystems = ['inventory', 'battle', 'merchant', 'bounties', 'mangler', 'loot_settings', 'effects', 'claims', 'journey', 'puzzle_log', 'gambling', 'battlefield_broadcast', 'puzzle_log_broadcast', 'merchant_stock'];
    assert.deepEqual(Object.keys(SUBSYSTEMS).sort(), expectedSubsystems.sort());
  });
});

describe('foreign key integrity', () => {
  test('deleting a campaign cascades to its characters and state', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Doomed Campaign');
    upsertCharacter(db, campaign.id, 'uid-1', { username: 'Ephemeral' });
    saveSubsystemState(db, campaign.id, 'journey', { journeyLog: ['one entry'] });
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
    assert.equal(listCharacters(db, campaign.id).length, 0);
    assert.equal(loadSubsystemState(db, campaign.id, 'journey'), null);
  });
});

describe('player_states (Phase 5a — per-player full state blobs)', () => {
  test('save and load round-trips a player\'s full state blob with its rev', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const blob = { inventoryGrid: [[null, 'itemKey1']], playerSlots: { weapon1: 'itemKey1' }, characterCurrentHp: 30 };
    savePlayerState(db, campaign.id, 'uid-1', blob, 3);
    const loaded = loadPlayerState(db, campaign.id, 'uid-1');
    assert.deepEqual(loaded.state, blob);
    assert.equal(loaded.rev, 3);
  });

  test('saving again for the same player overwrites rather than duplicating', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    savePlayerState(db, campaign.id, 'uid-1', { characterCurrentHp: 30 }, 1);
    savePlayerState(db, campaign.id, 'uid-1', { characterCurrentHp: 25 }, 2);
    const loaded = loadPlayerState(db, campaign.id, 'uid-1');
    assert.equal(loaded.state.characterCurrentHp, 25);
    assert.equal(loaded.rev, 2);
  });

  test('loadPlayerState returns null for a player who never pushed anything', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.equal(loadPlayerState(db, campaign.id, 'nobody'), null);
  });

  test('player state is scoped per campaign, same account_uid in two campaigns never collides', () => {
    const db = openDatabase(':memory:');
    const c1 = createCampaign(db, 'Campaign 1');
    const c2 = createCampaign(db, 'Campaign 2');
    savePlayerState(db, c1.id, 'uid-1', { characterCurrentHp: 10 }, 1);
    savePlayerState(db, c2.id, 'uid-1', { characterCurrentHp: 99 }, 1);
    assert.equal(loadPlayerState(db, c1.id, 'uid-1').state.characterCurrentHp, 10);
    assert.equal(loadPlayerState(db, c2.id, 'uid-1').state.characterCurrentHp, 99);
  });

  test('loadAllPlayerStates returns every player in a campaign', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    savePlayerState(db, campaign.id, 'uid-1', { characterCurrentHp: 10 }, 1);
    savePlayerState(db, campaign.id, 'uid-2', { characterCurrentHp: 20 }, 1);
    const all = loadAllPlayerStates(db, campaign.id);
    assert.equal(all.length, 2);
    assert.deepEqual(all.map(p => p.accountUid).sort(), ['uid-1', 'uid-2']);
  });

  test('deleting a campaign cascades to player_states too', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Doomed Campaign');
    savePlayerState(db, campaign.id, 'uid-1', { characterCurrentHp: 10 }, 1);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
    assert.equal(loadAllPlayerStates(db, campaign.id).length, 0);
  });
});

describe('loot_claims (Phase 5b — first-write-wins arbitration)', () => {
  test('the first claim on a given id wins', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const result = createLootClaim(db, campaign.id, 'monster1_item1', 'uid-alice', 'Alice');
    assert.equal(result.won, true);
    assert.equal(result.claimedByUid, 'uid-alice');
  });

  test('a second claim on the SAME id loses, and reports who actually won', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    createLootClaim(db, campaign.id, 'monster1_item1', 'uid-alice', 'Alice');
    const second = createLootClaim(db, campaign.id, 'monster1_item1', 'uid-bob', 'Bob');
    assert.equal(second.won, false);
    assert.equal(second.claimedByUid, 'uid-alice');
    assert.equal(second.claimedByUsername, 'Alice');
  });

  test('getLootClaim returns null for a claim id never created', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.equal(getLootClaim(db, campaign.id, 'never_claimed'), null);
  });

  test('the same claim id in two different campaigns never collides', () => {
    const db = openDatabase(':memory:');
    const c1 = createCampaign(db, 'Campaign 1');
    const c2 = createCampaign(db, 'Campaign 2');
    const r1 = createLootClaim(db, c1.id, 'monster1_item1', 'uid-alice', 'Alice');
    const r2 = createLootClaim(db, c2.id, 'monster1_item1', 'uid-bob', 'Bob');
    assert.equal(r1.won, true);
    assert.equal(r2.won, true); // same claim_id string, but a different campaign — not a collision
  });

  test('deleting a campaign cascades to loot_claims too', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Doomed Campaign');
    createLootClaim(db, campaign.id, 'monster1_item1', 'uid-alice', 'Alice');
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
    assert.equal(getLootClaim(db, campaign.id, 'monster1_item1'), null);
  });
});

describe('attack_requests (Phase 5d — DM review queue)', () => {
  test('creating a request returns it with a real id and the attack data intact', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const req = createAttackRequest(db, campaign.id, 'uid-1', 'Alice', { toHit: 15, damage: '2d6+3', targetUid: 'monster-1' });
    assert.ok(req.id > 0);
    assert.equal(req.playerUid, 'uid-1');
    assert.deepEqual(req.attackData, { toHit: 15, damage: '2d6+3', targetUid: 'monster-1' });
  });

  test('listAttackRequests returns every pending request, oldest first', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    createAttackRequest(db, campaign.id, 'uid-1', 'Alice', { toHit: 10 });
    createAttackRequest(db, campaign.id, 'uid-2', 'Bob', { toHit: 12 });
    const list = listAttackRequests(db, campaign.id);
    assert.equal(list.length, 2);
    assert.equal(list[0].playerUid, 'uid-1'); // created first, listed first
  });

  test('deleteAttackRequest removes it and reports success', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    const req = createAttackRequest(db, campaign.id, 'uid-1', 'Alice', { toHit: 10 });
    const deleted = deleteAttackRequest(db, campaign.id, req.id);
    assert.equal(deleted, true);
    assert.equal(listAttackRequests(db, campaign.id).length, 0);
  });

  test('deleting a request that no longer exists reports false, not an error', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Test');
    assert.equal(deleteAttackRequest(db, campaign.id, 999999), false);
  });

  test('deleting a campaign cascades to attack_requests too', () => {
    const db = openDatabase(':memory:');
    const campaign = createCampaign(db, 'Doomed Campaign');
    createAttackRequest(db, campaign.id, 'uid-1', 'Alice', { toHit: 10 });
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
    assert.equal(listAttackRequests(db, campaign.id).length, 0);
  });
});
