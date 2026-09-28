// Regression tests for the Phase 5a WebSocket sync layer. Run with: node --test
// Uses the 'ws' package as a real client connecting to a real WebSocket server (attached to a
// real http.Server on an OS-assigned port), same "real requests, not mocks" philosophy as
// server.test.js and gambling.test.js.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { WebSocket } from 'ws';
import { openDatabase, createCampaign, upsertCharacter, getCharacter } from '../db/database.js';
import { createWebSocketServer } from './websocket.js';

let db, httpServer, port, campaignId;
const sockets = []; // opened during a test, force-closed in afterEach even if a test fails early

beforeEach(async () => {
  db = openDatabase(':memory:');
  httpServer = createHttpServer();
  createWebSocketServer(db, httpServer);
  await new Promise(resolve => httpServer.listen(0, resolve));
  port = httpServer.address().port;
  campaignId = createCampaign(db, 'Test').id;
});

afterEach(async () => {
  sockets.forEach(ws => ws.close());
  sockets.length = 0;
  await new Promise(resolve => httpServer.close(resolve));
});

function connect() {
  const ws = new WebSocket(`ws://localhost:${port}`);
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function send(ws, msg) { ws.send(JSON.stringify(msg)); }
// Waits for the next message, with a short timeout so a test that wrongly expects a message
// (e.g. checking self-echo never arrives) fails fast rather than hanging.
function nextMessage(ws, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a message')), timeoutMs);
    ws.once('message', (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
  });
}
// Confirms NO message arrives within the window — used specifically to prove self-echo doesn't
// happen, which is the main behavioral difference from the original Firestore-based design.
function assertNoMessage(ws, timeoutMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    ws.once('message', (raw) => { clearTimeout(timer); reject(new Error('Expected no message, got: ' + raw.toString())); });
  });
}
// A real bug this file's own Phase 5c tests hit and needed this fix for: nextMessage's .once()
// listener is only attached at the moment it's CALLED — if a message can arrive on a connection
// before the test gets around to calling nextMessage on it (e.g. a broadcast triggered by a
// DIFFERENT connection's action, while this test is still busy awaiting something else first),
// Node's EventEmitter does not buffer it for a listener that attaches later; the message just
// fires into the void and is gone. messageQueue starts capturing every message the instant it's
// called (a persistent .on('message', ...), not .once()), queuing anything that arrives before
// next() is called for it — so it genuinely cannot lose a message to this race, regardless of
// how much other work happens between "this connection might receive something" and "the test
// actually checks for it."
function messageQueue(ws) {
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  return function next(timeoutMs = 500) {
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a queued message')), timeoutMs);
      waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
    });
  };
}
// Phase 5d added automatic roster_update broadcasts to the DM's connection any time a player
// connects, pushes state, or is affected by a cross-write — real, correct behavior, but it means
// any test with both a dm and a player connection can now see a roster_update interleaved with
// whatever else the DM's connection receives, in an order this file has no reason to pin down
// (and shouldn't need to, since these tests aren't testing roster behavior). Rather than
// asserting an exact message order that would make every such test fragile against an
// implementation detail, this skips past any roster_update noise to find the message actually
// being tested for — the same "don't lose messages to timing" discipline as messageQueue, just
// also permissive about a message type known to be expected-but-irrelevant here.
async function nextNonRosterMessage(queueNext) {
  let msg = await queueNext();
  while (msg.type === 'roster_update') msg = await queueNext();
  return msg;
}
// Sends push_state and waits for the server's push_ack before returning — replaces an earlier
// version of this file that used a fixed setTimeout("give the server a moment to process")
// instead. That produced real, if infrequent, flaky failures under variable system load: a
// fixed delay is never actually guaranteed to be long enough. Waiting for the real
// confirmation the server now sends (see server/websocket.js's push_ack) is what the original
// Firestore-based pushOwnState() could already do by awaiting its own setDoc() promise — this
// closes the same gap over WebSocket.
async function pushState(ws, rev, state) {
  send(ws, { type: 'push_state', rev, state });
  const ack = await nextMessage(ws);
  assert.equal(ack.type, 'push_ack');
  return ack;
}

// Shared by every describe block below that needs a connected+identified socket. Uses
// messageQueue internally (not the fragile nextMessage) so nothing arriving during identify can
// be lost, and attaches the resulting next() as ws.next so callers can keep reading this
// connection's later messages just as robustly. A DM's own identify unconditionally sends an
// initial roster_update and attack_request_list (Phase 5d catch-up) right after 'identified' —
// drained here so a connection returned by connectAs always starts with an empty queue, matching
// what every existing caller already assumes.
async function connectAs(accountUid, role) {
  const ws = await connect();
  const next = messageQueue(ws);
  send(ws, { type: 'identify', campaignId, accountUid, role, username: accountUid });
  const identified = await next();
  assert.equal(identified.type, 'identified');
  if (role === 'dm') {
    await next(); // roster_update
    await next(); // attack_request_list
  }
  ws.next = next;
  return ws;
}
// Counterpart to assertNoMessage, for connections using the messageQueue/connectAs pattern.
function assertNoQueuedMessage(next, timeoutMs = 300) {
  return assert.rejects(next(timeoutMs), /Timed out waiting for a queued message/);
}

describe('identify', () => {
  test('identifying with a real campaign acks with null state the first time', async () => {
    const ws = await connect();
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player', username: 'Alice' });
    const msg = await nextMessage(ws);
    assert.equal(msg.type, 'identified');
    assert.equal(msg.state, null);
    assert.equal(msg.rev, 0);
  });

  test('identifying with an unknown campaign returns an error', async () => {
    const ws = await connect();
    send(ws, { type: 'identify', campaignId: 999999, accountUid: 'uid-1', role: 'player' });
    const msg = await nextMessage(ws);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /999999/);
  });

  test('any message before identify is rejected', async () => {
    const ws = await connect();
    send(ws, { type: 'push_state', rev: 1, state: { characterCurrentHp: 10 } });
    const msg = await nextMessage(ws);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /identify/);
  });

  test('malformed JSON does not crash the connection', async () => {
    const ws = await connect();
    ws.send('{not valid json');
    const msg = await nextMessage(ws);
    assert.equal(msg.type, 'error');
  });

  // Phase 6c found this by accident (a browser tab duplicating a DM's session) — before this
  // fix, a second connection identifying with an already-live accountUid silently replaced the
  // room map entry, leaving the first connection open but untracked: no crash, just permanently
  // deaf to every future broadcast, hardest kind of bug to notice.
  test('a second connection with the same accountUid displaces the first, which is told and closed', async () => {
    const ws1 = await connectAs('uid-dm', 'dm');
    const ws2 = await connect();
    const next2 = messageQueue(ws2);
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-dm', role: 'dm', username: 'DM' });

    const displacedMsg = await ws1.next();
    assert.equal(displacedMsg.type, 'error');
    await new Promise((resolve) => ws1.once('close', resolve));

    const identified2 = await next2();
    assert.equal(identified2.type, 'identified');
    await next2(); // roster_update
    await next2(); // attack_request_list

    // Confirm the NEW connection, not the displaced old one, is what the server now considers
    // "the DM" for this campaign — a player joining should roster_update ws2, never ws1 (which
    // is already closed and couldn't receive it anyway, but this also proves the room map itself
    // was updated, not just that ws1 got disconnected).
    await connectAs('uid-player', 'player');
    const roster = await next2();
    assert.equal(roster.type, 'roster_update');
    assert.equal(roster.roster.length, 1);
  });

  test('identifying again with the SAME connection (no-op reconnect) does not close itself', async () => {
    const ws = await connectAs('uid-dm', 'dm');
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-dm', role: 'dm', username: 'DM' });
    const identified = await ws.next();
    assert.equal(identified.type, 'identified');
    await ws.next(); // roster_update
    await ws.next(); // attack_request_list
    assert.equal(ws.readyState, ws.OPEN);
  });
});

describe('push_state and reconnect', () => {
  test('a pushed state is persisted and visible to a fresh identify (reconnect)', async () => {
    const ws1 = await connect();
    send(ws1, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player', username: 'Alice' });
    await nextMessage(ws1);
    await pushState(ws1, 1, { characterCurrentHp: 25 });

    // Now simulate a reconnect with a fresh connection — the push above is confirmed persisted
    // (pushState awaited its ack) before this happens, not just assumed to have had "enough time."
    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player', username: 'Alice' });
    const msg = await nextMessage(ws2);
    assert.equal(msg.type, 'identified');
    assert.equal(msg.state.characterCurrentHp, 25);
    assert.equal(msg.rev, 1);
  });

  test('the pushing connection never receives its own push back (no self-echo)', async () => {
    const ws = await connect();
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player' });
    await nextMessage(ws);
    send(ws, { type: 'push_state', rev: 1, state: { characterCurrentHp: 25 } });
    // Deliberately NOT using pushState here — the whole point is to prove the ONLY message this
    // connection receives is its own push_ack, never a state_update. Consume the ack explicitly,
    // then confirm nothing else follows.
    const ack = await nextMessage(ws);
    assert.equal(ack.type, 'push_ack');
    await assertNoMessage(ws);
  });

  test('a stale (out-of-order) push is dropped, newer state is not clobbered', async () => {
    const ws = await connect();
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player' });
    await nextMessage(ws);
    await pushState(ws, 5, { characterCurrentHp: 40 });
    send(ws, { type: 'push_state', rev: 3, state: { characterCurrentHp: 1 } }); // arrives "late" with an older rev
    const rejection = await nextMessage(ws);
    assert.equal(rejection.type, 'push_rejected');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-1', role: 'player' });
    const msg = await nextMessage(ws2);
    assert.equal(msg.state.characterCurrentHp, 40); // the newer push wins, the stale one was rejected
  });
});

describe('cross-player writes (DM -> player)', () => {
  test('hp_delta reaches the target player live, clamped to their max HP', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 20, characterMaxHpEffective: 30 });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'hp_delta', targetUid: 'uid-player', delta: -5 });
    const update = await nextMessage(player);
    assert.equal(update.type, 'state_update');
    assert.equal(update.state.characterCurrentHp, 15);

    // Now push past the max and confirm it clamps rather than exceeding it.
    send(dm, { type: 'hp_delta', targetUid: 'uid-player', delta: 100 });
    const clamped = await nextMessage(player);
    assert.equal(clamped.state.characterCurrentHp, 30);
  });

  test('initiative_delta adjusts the target\'s initiative with no clamp (can go negative)', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterInitiative: 2 });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'initiative_delta', targetUid: 'uid-player', delta: -5 });
    const update = await nextMessage(player);
    assert.equal(update.type, 'state_update');
    assert.equal(update.state.characterInitiative, -3);
  });

  test('a fresh target with no prior initiative defaults to 0 before the delta is applied', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'initiative_delta', targetUid: 'uid-offline-player', delta: 4 });
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-offline-player', role: 'player' });
    const identified = await nextMessage(ws2);
    assert.equal(identified.state.characterInitiative, 4);
  });

  test('toggle_unlock_achieved marks a tier achieved, then unmarks it on a second toggle', async () => {
    const player = await connectAs('uid-player', 'player');
    const dm = await connectAs('uid-dm', 'dm');

    send(dm, { type: 'toggle_unlock_achieved', targetUid: 'uid-player', itemKey: 'loot:legendary:Emberfang, the Wyrmslayer Blade', tierIndex: 0 });
    let update = await nextMessage(player);
    assert.deepEqual(update.state.achievedUnlocks, [{ itemKey: 'loot:legendary:Emberfang, the Wyrmslayer Blade', tierIndex: 0 }]);

    send(dm, { type: 'toggle_unlock_achieved', targetUid: 'uid-player', itemKey: 'loot:legendary:Emberfang, the Wyrmslayer Blade', tierIndex: 0 });
    update = await nextMessage(player);
    assert.deepEqual(update.state.achievedUnlocks, []);
  });

  test('a non-DM cannot toggle an unlock tier', async () => {
    const player = await connectAs('uid-player', 'player');
    send(player, { type: 'toggle_unlock_achieved', targetUid: 'uid-player', itemKey: 'loot:common:Dagger', tierIndex: 0 });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('speed_delta adjusts the target\'s base speed, clamped to a minimum of 0', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterSpeed: 30 });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'speed_delta', targetUid: 'uid-player', delta: -10 });
    let update = await nextMessage(player);
    assert.equal(update.state.characterSpeed, 20);

    send(dm, { type: 'speed_delta', targetUid: 'uid-player', delta: -1000 });
    update = await nextMessage(player);
    assert.equal(update.state.characterSpeed, 0);
  });

  test('a fresh target with no prior speed defaults to 30 before the delta is applied', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'speed_delta', targetUid: 'uid-offline-player', delta: 10 });
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-offline-player', role: 'player' });
    const identified = await nextMessage(ws2);
    assert.equal(identified.state.characterSpeed, 40);
  });

  test('gift_item adds the item to the target\'s savedGeneratedItems and recentlyLooted', async () => {
    const player = await connectAs('uid-player', 'player');
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'gift_item', targetUid: 'uid-player', item: { name: 'Flametongue Sword', type: 'weapon' } });
    const update = await nextMessage(player);
    assert.equal(update.state.savedGeneratedItems.length, 1);
    assert.equal(update.state.savedGeneratedItems[0].name, 'Flametongue Sword');
    assert.equal(update.state.recentlyLooted.length, 1);
    assert.match(update.state.recentlyLooted[0], /^gen:/);
  });

  test('apply_item_effect heals the target via item.hp, using the shared applyItemEffectToState', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 3, characterMaxHpEffective: 10 });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'apply_item_effect', targetUid: 'uid-player', item: { name: 'Potion of Healing', hp: '2d4+2' } });
    const update = await nextMessage(player);
    assert.equal(update.type, 'state_update');
    assert.ok(update.state.characterCurrentHp > 3); // healed by at least the flat +2
    assert.ok(update.state.characterCurrentHp <= 10); // never past the effective max
  });

  test('apply_item_effect works on a target with no live connection (delivered on next identify)', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'apply_item_effect', targetUid: 'uid-offline-player', item: { name: 'Potion of Healing', hp: '2d4+2' } });
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-offline-player', role: 'player' });
    const identified = await nextMessage(ws2);
    assert.ok(identified.state.characterCurrentHp > 0);
  });

  test('apply_trap_effect deals full damage on a failed save, using the shared applyTrapEffectToState', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 50 });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'apply_trap_effect', targetUid: 'uid-player', trap: { name: 'Sundering Pendulum', damage: '6d10' }, saved: false });
    const update = await nextMessage(player);
    assert.equal(update.type, 'state_update');
    assert.ok(update.state.characterCurrentHp < 50); // damage was applied
  });

  test('apply_trap_effect halves damage and skips the condition when saved is true', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 50, activeTimedEffects: [] });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, {
      type: 'apply_trap_effect', targetUid: 'uid-player',
      trap: { name: 'Sablesting Cloud Vent', damage: '2d8', condition: 'Poisoned', conditionDuration: '10 minutes' },
      saved: true,
    });
    const update = await nextMessage(player);
    assert.ok(update.state.characterCurrentHp >= 42); // 2d8 max 16, halved max 8
    assert.deepEqual(update.state.activeTimedEffects, []); // no condition on a save
  });

  test('set_inventory_fields overwrites only the fields provided', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 20, characterClass: 'Ranger' });

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'set_inventory_fields', targetUid: 'uid-player', fields: { playerSlots: { weapon1: 'itemKey1' } } });
    const update = await nextMessage(player);
    assert.deepEqual(update.state.playerSlots, { weapon1: 'itemKey1' });
    assert.equal(update.state.characterCurrentHp, 20); // untouched
    assert.equal(update.state.characterClass, 'Ranger'); // untouched
  });

  test('a non-DM cannot perform cross-player writes', async () => {
    const player1 = await connectAs('uid-player-1', 'player');
    await connectAs('uid-player-2', 'player');
    send(player1, { type: 'hp_delta', targetUid: 'uid-player-2', delta: -5 });
    const msg = await nextMessage(player1);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('a cross-player write to a target with no live connection still persists (delivered on next identify)', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    // No prior state exists for this uid, so current HP defaults to 0 and the write floor-clamps
    // to 0 even without a known max — this is the correct, if slightly non-obvious, behavior of
    // the same clamp logic exercised elsewhere, not a special case for the offline path.
    //
    // The target isn't connected, so there's no state_update to wait on — but the DM's OWN
    // connection still gets cross_write_ack once the write actually lands, which is exactly the
    // confirmation needed here instead of assuming the write is "probably done by now."
    send(dm, { type: 'hp_delta', targetUid: 'uid-offline-player', delta: -5 });
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-offline-player', role: 'player' });
    const identified = await nextMessage(ws2);
    assert.equal(identified.state.characterCurrentHp, 0);
  });
});

describe('loot claims (Phase 5b — first-write-wins arbitration)', () => {
  test('a self-loot claim on an unclaimed id wins', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-alice', claimedByUsername: 'Alice' });
    const result = await nextMessage(player);
    assert.equal(result.type, 'loot_claim_result');
    assert.equal(result.won, true);
    assert.equal(result.claimedByUid, 'uid-alice');
  });

  test('two players racing for the SAME claim: exactly one wins, the loser learns who actually won', async () => {
    const alice = await connectAs('uid-alice', 'player');
    const bob = await connectAs('uid-bob', 'player');
    // Fired without awaiting between them — the point is to not control ordering, since the real
    // arbitration guarantee (the UNIQUE constraint in db/schema.js) has to hold regardless of
    // which one the server happens to process first.
    send(alice, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-alice', claimedByUsername: 'Alice' });
    send(bob, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-bob', claimedByUsername: 'Bob' });
    const [aliceResult, bobResult] = await Promise.all([nextMessage(alice), nextMessage(bob)]);

    const winners = [aliceResult, bobResult].filter(r => r.won);
    const losers = [aliceResult, bobResult].filter(r => !r.won);
    assert.equal(winners.length, 1, 'exactly one side should win the race');
    assert.equal(losers.length, 1);
    // The loser must be told who ACTUALLY won, not just that they lost — matching the original's
    // own claim doc, which is always readable regardless of who created it.
    assert.equal(losers[0].claimedByUid, winners[0].claimedByUid);
  });

  test('the DM\'s live connection is notified when a player wins a claim (for their roster)', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-alice', claimedByUsername: 'Alice' });
    await nextMessage(player); // consume the player's own loot_claim_result
    // Alice's own connectAs() just triggered a roster_update to the DM (Phase 5d) — skip past
    // that noise to find the loot_claim_update actually being tested for here.
    const dmUpdate = await nextNonRosterMessage(dm.next);
    assert.equal(dmUpdate.type, 'loot_claim_update');
    assert.equal(dmUpdate.claimedByUid, 'uid-alice');
  });

  test('the DM claiming on a player\'s behalf (a gift) does not send itself a duplicate notification', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-alice', claimedByUsername: 'Alice' });
    const result = await nextMessage(dm);
    assert.equal(result.type, 'loot_claim_result');
    assert.equal(result.won, true);
    // No second message should follow — the DM already knows via loot_claim_result above, and
    // this file's server code explicitly skips the separate DM notification when the DM was the
    // one who sent the claim in the first place.
    await assertNoMessage(dm);
  });

  test('a non-DM cannot create a claim on someone else\'s behalf', async () => {
    const alice = await connectAs('uid-alice', 'player');
    send(alice, { type: 'create_loot_claim', claimId: 'monster1_item1', claimedByUid: 'uid-bob', claimedByUsername: 'Bob' });
    const msg = await nextMessage(alice);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });
});

describe('battlefield broadcast (Phase 5c)', () => {
  const sampleEntry = {
    uid: 'monster-1', monster: 'Goblin', displayName: 'Goblin', variant: null, traits: [], chaosGearList: [],
    hp: 5, maxHp: 7, hpRoll: '2d6', ac: 13, statLines: [], lastResult: null, defeated: true, isCorpse: false,
    lootRevealed: true,
    loot: { tier: 'common', gold: 12, items: [{ id: 'item1', name: 'Rusty Dagger' }, { id: 'item2', name: 'Reserved Sword', reserved: true }, { id: 'item3', name: 'Claimed Shield', claimedBy: 'uid-someone' }] },
    // A field NOT on the allowlist, to confirm it's actually stripped, not just "happens to be absent."
    dmOnlySecretNotes: 'this should never reach a player',
  };

  test('a battlefield push reaches every connected player, never the DM', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player); // capture from here, before the DM's push can arrive
    send(dm, { type: 'push_battlefield', battleRoster: [sampleEntry], battleLog: ['Goblin defeated.'] });
    // Alice's connectAs() above triggered a roster_update to the DM (Phase 5d) — skip past it to
    // find the actual push ack being tested for here.
    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'push_battlefield_ack');
    await assertNoQueuedMessage(dm.next); // no battlefield_update for the DM itself

    const update = await playerNext();
    assert.equal(update.type, 'battlefield_update');
    assert.equal(update.battleRoster.length, 1);
  });

  test('unrevealed loot is never sent at all', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    const hidden = { ...sampleEntry, lootRevealed: false };
    send(dm, { type: 'push_battlefield', battleRoster: [hidden], battleLog: [] });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    assert.equal(update.battleRoster[0].loot, undefined);
  });

  test('revealed loot strips reserved and already-claimed items, keeps the rest', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_battlefield', battleRoster: [sampleEntry], battleLog: [] });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    const loot = update.battleRoster[0].loot;
    assert.equal(loot.tier, 'common');
    assert.equal(loot.gold, 12);
    assert.deepEqual(loot.items.map(i => i.id), ['item1']); // reserved and claimed items both stripped
  });

  test('only allowlisted fields reach the player — anything else (e.g. DM-only notes) is stripped', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_battlefield', battleRoster: [sampleEntry], battleLog: [] });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    assert.equal(update.battleRoster[0].dmOnlySecretNotes, undefined);
    assert.equal(update.battleRoster[0].monster, 'Goblin'); // a real allowlisted field does survive
  });

  test('battleLog is truncated to the last 50 entries', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    const longLog = Array.from({ length: 60 }, (_, i) => `Event ${i}`);
    send(dm, { type: 'push_battlefield', battleRoster: [], battleLog: longLog });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    assert.equal(update.battleLog.length, 50);
    assert.equal(update.battleLog[0], 'Event 10'); // the oldest 10 were dropped, not the newest
  });

  test('a player who identifies AFTER a push already happened catches up immediately', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_battlefield', battleRoster: [sampleEntry], battleLog: ['already happened'] });
    await nextMessage(dm);

    const ws = await connect();
    const wsNext = messageQueue(ws); // capture both 'identified' and the catch-up push, in order
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-late-player', role: 'player' });
    const identified = await wsNext();
    assert.equal(identified.type, 'identified');
    const catchUp = await wsNext(); // should NOT require a new push
    assert.equal(catchUp.type, 'battlefield_update');
    assert.equal(catchUp.battleLog[0], 'already happened');
  });

  test('a non-DM cannot push battlefield state', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'push_battlefield', battleRoster: [], battleLog: [] });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });
});

describe('battle map broadcast (Map Builder battle map)', () => {
  const sampleMap = { id: 'map-1', name: 'Goblin Warren', w: 5, h: 5, cellPx: 24, cells: [], edges: {}, props: [] };
  const sampleTokens = [{ id: 'tok-1', kind: 'monster', refUid: 'monster-1', icon: 'monster', x: 2, y: 3, label: 'Goblin (5/7 HP)' }];

  test('a battle map push reaches every connected player, never the DM', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_battle_map', activeBattleMap: sampleMap, battleMapTokens: sampleTokens });
    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'push_battle_map_ack');
    await assertNoQueuedMessage(dm.next); // no battle_map_update for the DM itself

    const update = await playerNext();
    assert.equal(update.type, 'battle_map_update');
    assert.equal(update.activeBattleMap.name, 'Goblin Warren');
    assert.equal(update.battleMapTokens.length, 1);
  });

  test('the map and token fields pass through unfiltered — nothing here is loot-style stripped', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_battle_map', activeBattleMap: sampleMap, battleMapTokens: sampleTokens });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    assert.deepEqual(update.activeBattleMap, sampleMap);
    assert.deepEqual(update.battleMapTokens, sampleTokens);
  });

  test('clearing the battle map (null) reaches players too', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_battle_map', activeBattleMap: null, battleMapTokens: [] });
    await nextNonRosterMessage(dm.next);
    const update = await playerNext();
    assert.equal(update.activeBattleMap, null);
    assert.deepEqual(update.battleMapTokens, []);
  });

  test('a push_battlefield and a push_battle_map do not clobber each other on reconnect catch-up', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_battlefield', battleRoster: [{ uid: 'monster-1', monster: 'Goblin', hp: 5, maxHp: 7 }], battleLog: ['hit'] });
    await nextMessage(dm);
    send(dm, { type: 'push_battle_map', activeBattleMap: sampleMap, battleMapTokens: sampleTokens });
    await nextNonRosterMessage(dm.next);

    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-late-player', role: 'player' });
    await wsNext(); // 'identified'
    const rosterCatchUp = await wsNext();
    assert.equal(rosterCatchUp.type, 'battlefield_update');
    assert.equal(rosterCatchUp.battleRoster[0].monster, 'Goblin');
    const mapCatchUp = await wsNext();
    assert.equal(mapCatchUp.type, 'battle_map_update');
    assert.equal(mapCatchUp.activeBattleMap.name, 'Goblin Warren');
  });

  test('a non-DM cannot push battle map state', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'push_battle_map', activeBattleMap: sampleMap, battleMapTokens: [] });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });
});

describe('puzzle log broadcast (Phase 5c)', () => {
  test('a puzzle log push reaches every connected player, never the DM', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    send(dm, { type: 'push_puzzle_log', puzzleLog: [{ riddle: 'What has keys but no locks?', answer: 'A piano' }] });
    // Alice's connectAs() above triggered a roster_update to the DM (Phase 5d) — skip past it to
    // find the actual push ack being tested for here.
    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'push_puzzle_log_ack');
    await assertNoQueuedMessage(dm.next);

    const update = await playerNext();
    assert.equal(update.type, 'puzzle_log_update');
    assert.equal(update.puzzleLog.length, 1);
    assert.equal(update.puzzleLog[0].answer, 'A piano');
  });

  test('a player who identifies AFTER a push already happened catches up immediately', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_puzzle_log', puzzleLog: [{ riddle: 'Already published', answer: '...' }] });
    await nextMessage(dm);

    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-late-player', role: 'player' });
    const identified = await wsNext();
    assert.equal(identified.type, 'identified');
    const catchUp = await wsNext();
    assert.equal(catchUp.type, 'puzzle_log_update');
    assert.equal(catchUp.puzzleLog[0].riddle, 'Already published');
  });

  test('a non-DM cannot push the puzzle log', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'push_puzzle_log', puzzleLog: [] });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });
});

describe('DM roster listener (Phase 5d)', () => {
  test('the DM gets an empty roster and empty attack list immediately on identify', async () => {
    const ws = await connect();
    const next = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-dm', role: 'dm', username: 'DM' });
    const identified = await next();
    assert.equal(identified.type, 'identified');
    const roster = await next();
    assert.equal(roster.type, 'roster_update');
    assert.deepEqual(roster.roster, []);
    const requests = await next();
    assert.equal(requests.type, 'attack_request_list');
    assert.deepEqual(requests.requests, []);
  });

  test('a player connecting adds them to the DM\'s roster; pushing state updates their stats', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-player', 'player');
    const joinRoster = await dm.next();
    assert.equal(joinRoster.type, 'roster_update');
    assert.equal(joinRoster.roster.length, 1);
    assert.equal(joinRoster.roster[0].uid, 'uid-player');
    // Regression coverage for a real bug Phase 6e's browser testing found: the monolith's
    // renderPlayersTab() filters on exactly `p.role === 'player'` — a roster entry missing this
    // field made the Players tab silently show nobody, undetected since Phase 5d because nothing
    // exercised that specific consumer until 6e.
    assert.equal(joinRoster.roster[0].role, 'player');

    await pushState(player, 1, { characterCurrentHp: 18, characterMaxHpEffective: 25, characterAc: 16 });
    const statsRoster = await dm.next();
    assert.equal(statsRoster.type, 'roster_update');
    assert.equal(statsRoster.roster[0].currentHp, 18);
    assert.equal(statsRoster.roster[0].maxHp, 25);
    assert.equal(statsRoster.roster[0].ac, 16);
  });

  test('roster current HP is clamped to max HP, matching startRosterListener\'s own clamp', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-player', 'player');
    await dm.next(); // join roster_update

    await pushState(player, 1, { characterCurrentHp: 999, characterMaxHpEffective: 30 });
    const roster = await dm.next();
    assert.equal(roster.roster[0].currentHp, 30); // clamped, not 999
  });

  test('a DM cross-write (hp_delta) landing also refreshes the roster', async () => {
    const player = await connectAs('uid-player', 'player');
    await pushState(player, 1, { characterCurrentHp: 20, characterMaxHpEffective: 30 });
    // connectAs already drains the DM's own initial roster_update (which reflects the player
    // connected above, since it's built fresh on every identify) as part of identify catch-up —
    // nothing extra to consume here before the cross-write itself.
    const dm = await connectAs('uid-dm', 'dm');

    send(dm, { type: 'hp_delta', targetUid: 'uid-player', delta: -5 });
    await nextMessage(player); // consume the target's state_update
    // Order on the DM's own connection: cross_write_ack first, then the roster refresh.
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');
    const roster = await dm.next();
    assert.equal(roster.type, 'roster_update');
    assert.equal(roster.roster[0].currentHp, 15);
  });

  test('a disconnecting player drops off the DM\'s roster', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-player', 'player');
    await dm.next(); // join roster_update, player present

    player.close();
    const roster = await dm.next();
    assert.equal(roster.type, 'roster_update');
    assert.deepEqual(roster.roster, []);
  });

  test('players never receive roster_update — it is DM-only', async () => {
    const player = await connectAs('uid-player', 'player');
    const playerNext = messageQueue(player);
    await connectAs('uid-dm', 'dm');
    await connectAs('uid-other-player', 'player'); // triggers a roster_update, but only to the DM
    await assertNoQueuedMessage(playerNext, 300);
  });
});

describe('attack-request review queue (Phase 5d)', () => {
  test('submitting an attack acks the player and sends the DM the full list', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    await dm.next(); // Alice's connect-triggered roster_update

    send(player, { type: 'submit_attack_request', attack: { toHit: 15, damage: 8, targetUid: 'monster-1' } });
    const ack = await nextMessage(player);
    assert.equal(ack.type, 'attack_request_submitted');
    assert.equal(typeof ack.requestId, 'number');

    const list = await dm.next();
    assert.equal(list.type, 'attack_request_list');
    assert.equal(list.requests.length, 1);
    assert.equal(list.requests[0].playerUid, 'uid-alice');
    assert.equal(list.requests[0].playerUsername, 'uid-alice'); // connectAs uses accountUid as username
    assert.deepEqual(list.requests[0].attackData, { toHit: 15, damage: 8, targetUid: 'monster-1' });
  });

  test('multiple pending requests all appear, oldest first', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const alice = await connectAs('uid-alice', 'player');
    const bob = await connectAs('uid-bob', 'player');
    await dm.next(); // alice's join roster_update
    await dm.next(); // bob's join roster_update

    send(alice, { type: 'submit_attack_request', attack: { move: 'first' } });
    await nextMessage(alice);
    await dm.next(); // list with 1 entry

    send(bob, { type: 'submit_attack_request', attack: { move: 'second' } });
    await nextMessage(bob);
    const list = await dm.next(); // list with 2 entries
    assert.equal(list.requests.length, 2);
    assert.equal(list.requests[0].attackData.move, 'first');
    assert.equal(list.requests[1].attackData.move, 'second');
  });

  test('resolving a request (DM only) removes it and re-sends the updated full list', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    await dm.next(); // join roster_update

    send(player, { type: 'submit_attack_request', attack: { move: 'x' } });
    await nextMessage(player);
    const list1 = await dm.next();
    const requestId = list1.requests[0].id;

    send(dm, { type: 'resolve_attack_request', requestId });
    const resolved = await dm.next();
    assert.equal(resolved.type, 'attack_request_resolved');
    assert.equal(resolved.requestId, requestId);
    const list2 = await dm.next();
    assert.equal(list2.type, 'attack_request_list');
    assert.deepEqual(list2.requests, []);
  });

  test('a non-DM cannot resolve an attack request', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'resolve_attack_request', requestId: 1 });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('a DM connecting after requests already exist catches up via attack_request_list on identify', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'submit_attack_request', attack: { move: 'already pending' } });
    await nextMessage(player); // ack — no DM connected yet to receive the list broadcast

    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-dm', role: 'dm', username: 'DM' });
    const identified = await wsNext();
    assert.equal(identified.type, 'identified');
    const roster = await wsNext();
    assert.equal(roster.type, 'roster_update');
    const list = await wsNext();
    assert.equal(list.type, 'attack_request_list');
    assert.equal(list.requests.length, 1);
    assert.equal(list.requests[0].attackData.move, 'already pending');
  });
});

describe('viewed-player listener (Phase 6e)', () => {
  test('subscribing to a player with no state yet gets a null player_state_update', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    await connectAs('uid-alice', 'player');
    await dm.next(); // roster_update from alice joining

    send(dm, { type: 'subscribe_player', targetUid: 'uid-alice' });
    const update = await dm.next();
    assert.equal(update.type, 'player_state_update');
    assert.equal(update.targetUid, 'uid-alice');
    assert.equal(update.state, null);
  });

  test('subscribing to a player with existing state gets it immediately (catch-up)', async () => {
    const alice = await connectAs('uid-alice', 'player');
    await pushState(alice, 1, { characterClass: 'Rogue' });
    const dm = await connectAs('uid-dm', 'dm');

    send(dm, { type: 'subscribe_player', targetUid: 'uid-alice' });
    const update = await dm.next();
    assert.equal(update.type, 'player_state_update');
    assert.equal(update.state.characterClass, 'Rogue');
  });

  test("a subscribed player's own push notifies the DM live", async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const alice = await connectAs('uid-alice', 'player');
    await dm.next(); // roster_update from alice joining
    send(dm, { type: 'subscribe_player', targetUid: 'uid-alice' });
    await dm.next(); // initial null catch-up

    await pushState(alice, 1, { characterClass: 'Wizard' });
    const update = await nextNonRosterMessage(dm.next);
    assert.equal(update.type, 'player_state_update');
    assert.equal(update.state.characterClass, 'Wizard');
  });

  test('a DM cross-write to the subscribed target also notifies the viewer', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const alice = await connectAs('uid-alice', 'player');
    await dm.next(); // roster_update from alice joining
    await pushState(alice, 1, { characterCurrentHp: 10, characterMaxHpEffective: 30 });
    await dm.next(); // roster_update from alice's push
    send(dm, { type: 'subscribe_player', targetUid: 'uid-alice' });
    await dm.next(); // catch-up with alice's just-pushed state

    send(dm, { type: 'hp_delta', targetUid: 'uid-alice', delta: -3 });
    await nextMessage(alice); // alice's own state_update
    const ack = await dm.next();
    assert.equal(ack.type, 'cross_write_ack');
    const roster = await dm.next();
    assert.equal(roster.type, 'roster_update');
    const update = await dm.next();
    assert.equal(update.type, 'player_state_update');
    assert.equal(update.state.characterCurrentHp, 7);
  });

  test('switching subscription stops notifications from the old target', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const alice = await connectAs('uid-alice', 'player');
    const bob = await connectAs('uid-bob', 'player');
    await dm.next(); await dm.next(); // roster_updates from alice/bob joining
    send(dm, { type: 'subscribe_player', targetUid: 'uid-alice' });
    await dm.next(); // catch-up for alice
    send(dm, { type: 'subscribe_player', targetUid: 'uid-bob' });
    await dm.next(); // catch-up for bob

    await pushState(alice, 1, { characterClass: 'Rogue' });
    // Only bob's subscription is live now — alice's push produces just the ordinary
    // roster_update, never a player_state_update for a subscription that's been replaced.
    const afterAlice = await dm.next();
    assert.equal(afterAlice.type, 'roster_update');
    await assertNoQueuedMessage(dm.next, 200);

    await pushState(bob, 1, { characterClass: 'Cleric' });
    const afterBob = await nextNonRosterMessage(dm.next);
    assert.equal(afterBob.type, 'player_state_update');
    assert.equal(afterBob.targetUid, 'uid-bob');
    assert.equal(afterBob.state.characterClass, 'Cleric');
  });

  test('a non-DM cannot subscribe to a player', async () => {
    const alice = await connectAs('uid-alice', 'player');
    send(alice, { type: 'subscribe_player', targetUid: 'uid-bob' });
    const msg = await nextMessage(alice);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });
});

describe('player removal (Phase 6f)', () => {
  test("kicking a player deletes their persisted state and closes their connection with a reason", async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const alice = await connectAs('uid-alice', 'player');
    await dm.next(); // roster_update from alice joining
    await pushState(alice, 1, { characterClass: 'Rogue' });
    await dm.next(); // roster_update from alice's push

    send(dm, { type: 'kick_player', targetUid: 'uid-alice' });
    const kickedMsg = await nextMessage(alice);
    assert.equal(kickedMsg.type, 'kicked');
    await new Promise((resolve) => alice.once('close', resolve));

    const ack = await dm.next();
    assert.equal(ack.type, 'kick_ack');
    assert.equal(ack.targetUid, 'uid-alice');
    const roster = await dm.next();
    assert.equal(roster.type, 'roster_update');
    assert.equal(roster.roster.length, 0);

    // Confirm the persisted state is genuinely gone — reconnecting starts completely fresh.
    const rejoin = await connect();
    send(rejoin, { type: 'identify', campaignId, accountUid: 'uid-alice', role: 'player', username: 'Alice' });
    const identified = await nextMessage(rejoin);
    assert.equal(identified.state, null);
  });

  test('a non-DM cannot kick a player', async () => {
    const alice = await connectAs('uid-alice', 'player');
    send(alice, { type: 'kick_player', targetUid: 'uid-bob' });
    const msg = await nextMessage(alice);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('the DM cannot remove themselves', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'kick_player', targetUid: 'uid-dm' });
    const msg = await dm.next();
    assert.equal(msg.type, 'error');
  });

  test('kicking an already-offline player still deletes their persisted state', async () => {
    const alice = await connectAs('uid-alice', 'player');
    await pushState(alice, 1, { characterClass: 'Rogue' });
    alice.close();
    await new Promise((resolve) => alice.once('close', resolve));

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'kick_player', targetUid: 'uid-alice' });
    const ack = await dm.next();
    assert.equal(ack.type, 'kick_ack');

    const rejoin = await connect();
    send(rejoin, { type: 'identify', campaignId, accountUid: 'uid-alice', role: 'player', username: 'Alice' });
    const identified = await nextMessage(rejoin);
    assert.equal(identified.state, null);
  });
});

describe('real-time gambling sync (Phase 6d)', () => {
  test('a gambling state push reaches every connected player, never the DM', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    const playerNext = messageQueue(player);
    const state = { game: 'roulette', table: { phase: 'betting', bets: {} } };
    send(dm, { type: 'push_gambling_state', state });
    // Alice's connectAs() above triggered a roster_update to the DM (Phase 5d) — skip past it.
    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'push_gambling_state_ack');
    await assertNoQueuedMessage(dm.next); // no gambling_state_update echoed back to the DM itself

    const update = await playerNext();
    assert.equal(update.type, 'gambling_state_update');
    assert.equal(update.state.game, 'roulette');
  });

  test('a player who identifies AFTER a table is already hosted catches up immediately', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_gambling_state', state: { game: 'blackjack', table: { phase: 'betting' } } });
    await nextMessage(dm);

    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-late-player', role: 'player' });
    const identified = await wsNext();
    assert.equal(identified.type, 'identified');
    const catchUp = await wsNext();
    assert.equal(catchUp.type, 'gambling_state_update');
    assert.equal(catchUp.state.game, 'blackjack');
  });

  test('a player who identifies while NO table is hosted gets no catch-up message', async () => {
    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-alice', role: 'player' });
    await wsNext(); // identified
    await assert.rejects(wsNext(200), /Timed out/);
  });

  test('a non-DM cannot push gambling state', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'push_gambling_state', state: { game: 'slots', table: {} } });
    const msg = await nextMessage(player);
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test("a player's submitted action is relayed to the DM's connection, wrapped in a list", async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'submit_gambling_action', action: { type: 'place_bet', amount: 50 } });

    const submittedAck = await nextMessage(player);
    assert.equal(submittedAck.type, 'gambling_action_submitted');

    const relayed = await nextNonRosterMessage(dm.next);
    assert.equal(relayed.type, 'gambling_action_list');
    assert.equal(relayed.actions.length, 1);
    assert.equal(relayed.actions[0].type, 'place_bet');
    assert.equal(relayed.actions[0].amount, 50);
    assert.equal(relayed.actions[0].playerUid, 'uid-alice');
    assert.ok(relayed.actions[0].id); // assigned an id even though nothing is persisted server-side
  });

  test('submitting an action while no DM is connected is a graceful no-op, not an error', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'submit_gambling_action', action: { type: 'spin' } });
    const ack = await nextMessage(player);
    assert.equal(ack.type, 'gambling_action_submitted'); // still acks the submitter even though no one received it
  });
});

describe('store purchase sync — staple stock arbitration', () => {
  // buy_staple always triggers TWO messages back-to-back on the buyer's own connection
  // (buy_staple_result, then its own copy of the merchant_stock_update broadcast) — close enough
  // together that they can both arrive and get 'message'-emitted before a test's `await
  // nextMessage(...)` continuation even runs, exactly the message-loss race Phase 5c's own
  // messageQueue helper exists to close (see this file's top-of-file comment on it). Every test
  // below uses connectAs's exposed `.next` queue instead of raw nextMessage for that reason.
  test('the first purchase seeds shared stock from the client-supplied maxStock and decrements it', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'buy_staple', merchantKey: 'blacksmith', index: 0, maxStock: [8, 15, 8, 5, 3] });
    const result = await player.next();
    assert.equal(result.type, 'buy_staple_result');
    assert.equal(result.bought, true);

    const update = await player.next();
    assert.equal(update.type, 'merchant_stock_update');
    assert.equal(update.merchantKey, 'blacksmith');
    assert.deepEqual(update.remaining, [7, 15, 8, 5, 3]); // only index 0 decremented
  });

  test('buying down to zero then buying again is rejected, not decremented below zero', async () => {
    const player = await connectAs('uid-alice', 'player');
    // Index 2 starts at 3 — buy it out exactly, confirming each of the 3 succeeds.
    for (let i = 0; i < 3; i++) {
      send(player, { type: 'buy_staple', merchantKey: 'alchemist', index: 2, maxStock: [1, 1, 3] });
      const result = await player.next();
      assert.equal(result.bought, true, `purchase ${i + 1} of 3 should succeed`);
      await player.next(); // merchant_stock_update
    }
    // A 4th attempt against the now-empty stock must be rejected, not go negative. A rejected
    // purchase changes nothing, so — unlike a successful one — it sends no merchant_stock_update
    // broadcast at all (see the handler's own comment); buy_staple_result alone is the complete
    // answer here.
    send(player, { type: 'buy_staple', merchantKey: 'alchemist', index: 2, maxStock: [1, 1, 3] });
    const result = await player.next();
    assert.equal(result.bought, false);
    await assertNoQueuedMessage(player.next);
  });

  test('two players racing for the LAST unit: exactly one wins, both converge on the same final count', async () => {
    const alice = await connectAs('uid-alice', 'player');
    const bob = await connectAs('uid-bob', 'player');
    // Fired without awaiting between them, same reasoning as the loot-claim race test above —
    // the arbitration has to hold regardless of processing order. Each connection gets exactly
    // two messages (its own buy_staple_result, plus the ONE merchant_stock_update the winning
    // side's purchase broadcasts to the whole room — a rejected purchase broadcasts nothing, see
    // the handler's own comment), but NOT in a guaranteed order relative to each other: the
    // loser's own result and the winner's broadcast come from two independently-processed
    // requests, so this collects both messages per connection and classifies by type rather than
    // assuming a fixed position — the same reasoning messageQueue exists for in the first place.
    send(alice, { type: 'buy_staple', merchantKey: 'mage', index: 0, maxStock: [1] });
    send(bob, { type: 'buy_staple', merchantKey: 'mage', index: 0, maxStock: [1] });
    const aliceMsgs = [await alice.next(), await alice.next()];
    const bobMsgs = [await bob.next(), await bob.next()];

    const results = [...aliceMsgs, ...bobMsgs].filter(m => m.type === 'buy_staple_result');
    assert.equal(results.length, 2);
    const winners = results.filter(r => r.bought);
    assert.equal(winners.length, 1, 'exactly one side should win the last unit');

    // Exactly one merchant_stock_update fires (the winner's), but the room broadcast means BOTH
    // connections receive that same one copy.
    const aliceUpdate = aliceMsgs.find(m => m.type === 'merchant_stock_update');
    const bobUpdate = bobMsgs.find(m => m.type === 'merchant_stock_update');
    assert.deepEqual(aliceUpdate.remaining, [0]);
    assert.deepEqual(bobUpdate.remaining, [0]);
  });

  test('the DM sees a player\'s purchase live, including the DM\'s own connection in the broadcast', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'buy_staple', merchantKey: 'trader', index: 1, maxStock: [40, 50, 30] });
    await player.next(); // buy_staple_result
    await player.next(); // merchant_stock_update to the buyer

    // Alice's own connectAs() triggered a roster_update to the DM (Phase 5d) — skip past it.
    const dmUpdate = await nextNonRosterMessage(dm.next);
    assert.equal(dmUpdate.type, 'merchant_stock_update');
    assert.equal(dmUpdate.merchantKey, 'trader');
    assert.deepEqual(dmUpdate.remaining, [40, 49, 30]);
  });

  test('a non-DM cannot restock a merchant', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'restock_merchant', merchantKey: 'trader', maxStock: [40, 50, 30] });
    const msg = await player.next();
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('the DM restocking resets shared stock back to full for everyone, including a connected player', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'buy_staple', merchantKey: 'trader', index: 0, maxStock: [40, 50, 30] });
    await player.next();
    await player.next();
    await nextNonRosterMessage(dm.next); // the purchase's own broadcast to the DM

    send(dm, { type: 'restock_merchant', merchantKey: 'trader', maxStock: [40, 50, 30] });
    const dmUpdate = await nextNonRosterMessage(dm.next);
    assert.equal(dmUpdate.type, 'merchant_stock_update');
    assert.deepEqual(dmUpdate.remaining, [40, 50, 30]);
    const playerUpdate = await player.next();
    assert.deepEqual(playerUpdate.remaining, [40, 50, 30]);
  });

  test('a player who connects AFTER purchases already happened catches up via merchant_stock_full on identify', async () => {
    const first = await connectAs('uid-alice', 'player');
    send(first, { type: 'buy_staple', merchantKey: 'trader', index: 0, maxStock: [40, 50, 30] });
    await first.next();
    await first.next();

    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-late-player', role: 'player' });
    const identified = await wsNext();
    assert.equal(identified.type, 'identified');
    const catchUp = await wsNext();
    assert.equal(catchUp.type, 'merchant_stock_full');
    assert.deepEqual(catchUp.stock.trader, [39, 50, 30]);
  });

  test('a fresh campaign with no purchases yet sends no merchant_stock_full at all on identify', async () => {
    const ws = await connect();
    const wsNext = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-alice', role: 'player' });
    await wsNext(); // identified
    await assert.rejects(wsNext(200), /Timed out/);
  });

  test('an invalid buy_staple request (missing merchantKey) is rejected with an error, not a crash', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'buy_staple', index: 0, maxStock: [5] });
    const msg = await player.next();
    assert.equal(msg.type, 'error');
  });
});

describe('simulate a day (Phase 6k — long rest for every player)', () => {
  test('a non-DM cannot simulate a day', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'simulate_day' });
    const msg = await player.next();
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('heals a connected player to full, clears timed effects, and refills a per-day item charge — but leaves a "1 use" item alone', async () => {
    const player = await connectAs('uid-alice', 'player');
    await pushState(player, 1, {
      characterCurrentHp: 3, characterMaxHpEffective: 30,
      activeTimedEffects: [{ id: 'aeff1', name: 'Bull\'s Strength', expiresAt: Date.now() + 60000 }],
      savedGeneratedItems: [
        { id: 'g1', name: 'Wand of Sparks', charges: '2/day', chargesFormat: '3/day' },
        { id: 'g2', name: 'Healing Potion', charges: '0', chargesFormat: '1 use' },
      ],
    });
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'simulate_day' });

    // pushState above already consumed player's push_ack via a plain nextMessage listener (see
    // its own comment) rather than player's messageQueue — matching every other test that mixes
    // pushState with a connectAs'd connection (e.g. the hp_delta test above), so this reads the
    // same way: a fresh nextMessage, not player.next()/the queue.
    const update = await nextMessage(player);
    assert.equal(update.type, 'state_update');
    assert.equal(update.state.characterCurrentHp, 30);
    assert.deepEqual(update.state.activeTimedEffects, []);
    const wand = update.state.savedGeneratedItems.find(it => it.id === 'g1');
    assert.equal(wand.charges, '3/day');
    const potion = update.state.savedGeneratedItems.find(it => it.id === 'g2');
    assert.equal(potion.charges, '0'); // a "1 use" item never comes back on its own

    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'simulate_day_ack');
  });

  test('also rests a player who is not currently connected, delivered on their next identify', async () => {
    const offline = await connectAs('uid-offline', 'player');
    await pushState(offline, 1, { characterCurrentHp: 1, characterMaxHpEffective: 20 });
    offline.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'simulate_day' });
    const ack = await nextNonRosterMessage(dm.next);
    assert.equal(ack.type, 'simulate_day_ack');

    const ws2 = await connect();
    send(ws2, { type: 'identify', campaignId, accountUid: 'uid-offline', role: 'player' });
    const identified = await nextMessage(ws2);
    assert.equal(identified.state.characterCurrentHp, 20);
  });

  test('day_advanced reaches every connected player but never echoes back to the triggering DM', async () => {
    const player = await connectAs('uid-alice', 'player');
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'simulate_day' });

    const advanced = await nextNonRosterMessage(player.next);
    assert.equal(advanced.type, 'day_advanced');

    // The DM's own next message is the ack, not a day_advanced echo.
    const dmMsg = await nextNonRosterMessage(dm.next);
    assert.equal(dmMsg.type, 'simulate_day_ack');
  });
});

describe('combat (Phase 3 of the mechanics rebuild)', () => {
  // An absurdly high attackBonus makes every non-fumble roll a comfortable hit with a large
  // margin-driven damage bonus, regardless of the d20 face — but NOT actually guaranteed to hit:
  // resolveAttack always fumbles on a
  // natural 1, unconditionally, regardless of bonuses (matching 5e's "a nat 1 always misses"
  // rule) — a genuine ~5% miss chance on any single attack that these tests can't route around
  // via bonuses alone. Tests that need to observe a hit use attackUntilHit below rather than
  // asserting on a single attempt, so they test the real server-side random resolution path
  // instead of a rigged one, without a ~1-in-20 chance of failing for a reason that isn't a bug.
  const SURE_HIT_MONSTER = { id: 'm1', kind: 'monster', name: 'Goblin', ac: 5, currentHp: 20, maxHp: 20, attackBonus: 100, damageDice: '1d4', damageType: 'piercing' };

  // Retries a combat_attack until the server reports a hit (or gives up after enough attempts
  // that a real bug, not bad luck, is overwhelmingly the more likely explanation — 10 consecutive
  // natural 1s is a 1-in-10^13 chance). Returns the combat_state_update from the attempt that hit.
  // `senderWs` sends the attack; `readerNext` (a messageQueue's next()) is whichever connection's
  // broadcast copy the caller actually wants to inspect — not always the same connection, since
  // broadcastToRoom reaches every connection in the room, not just the sender.
  async function attackUntilHit(senderWs, readerNext, attackerId, targetId, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      send(senderWs, { type: 'combat_attack', attackerId, targetId });
      const update = await nextNonRosterMessage(readerNext);
      if (update.log.at(-1).result.isHit) return update;
    }
    throw new Error(`No hit after ${maxAttempts} attempts — suspiciously unlucky or a real bug`);
  }

  test('a non-DM cannot push combat state', async () => {
    const player = await connectAs('uid-alice', 'player');
    send(player, { type: 'push_combat_state', roster: [], active: true, roundNumber: 1 });
    const msg = await player.next();
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /DM/);
  });

  test('pushing combat state broadcasts the enriched roster to the whole room, DM included', async () => {
    upsertCharacter(db, campaignId, 'uid-alice', {
      abilityScores: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, ac: 15, currentHp: 25, maxHp: 25, maxHpEffective: 25,
    });
    const player = await connectAs('uid-alice', 'player');
    const dm = await connectAs('uid-dm', 'dm');
    const roster = [{ id: 'p1', kind: 'pc', name: 'Alice', accountUid: 'uid-alice' }, SURE_HIT_MONSTER];
    send(dm, { type: 'push_combat_state', roster, active: true, roundNumber: 1 });

    const dmUpdate = await nextNonRosterMessage(dm.next);
    assert.equal(dmUpdate.type, 'combat_state_update');
    const pcEntry = dmUpdate.roster.find(e => e.id === 'p1');
    assert.equal(pcEntry.ac, 15); // enriched live from the characters table, not the bare push
    assert.equal(pcEntry.currentHp, 25);
    const monsterEntry = dmUpdate.roster.find(e => e.id === 'm1');
    assert.equal(monsterEntry.currentHp, 20); // monster entries pass through as pushed

    const playerUpdate = await nextNonRosterMessage(player.next);
    assert.equal(playerUpdate.type, 'combat_state_update');
    assert.equal(playerUpdate.roster.length, 2);
  });

  test('a player who connects after combat was already started gets immediate catch-up', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_combat_state', roster: [SURE_HIT_MONSTER], active: true, roundNumber: 3 });
    await nextNonRosterMessage(dm.next); // drain the DM's own broadcast

    const ws = await connect();
    const next = messageQueue(ws);
    send(ws, { type: 'identify', campaignId, accountUid: 'uid-bob', role: 'player' });
    await next(); // identified
    const combatUpdate = await next();
    assert.equal(combatUpdate.type, 'combat_state_update');
    assert.equal(combatUpdate.roundNumber, 3);
    assert.equal(combatUpdate.roster[0].name, 'Goblin');
  });

  test('a PC attacking a monster resolves server-side and reduces the monster\'s HP', async () => {
    upsertCharacter(db, campaignId, 'uid-alice', {
      abilityScores: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 5, ac: 15, currentHp: 25, maxHp: 25, maxHpEffective: 25,
    });
    const dm = await connectAs('uid-dm', 'dm');
    const roster = [{ id: 'p1', kind: 'pc', name: 'Alice', accountUid: 'uid-alice' }, { ...SURE_HIT_MONSTER, ac: 1 }];
    send(dm, { type: 'push_combat_state', roster, active: true, roundNumber: 1 });
    await nextNonRosterMessage(dm.next);

    const update = await attackUntilHit(dm, dm.next, 'p1', 'm1');
    assert.equal(update.type, 'combat_state_update');
    const monster = update.roster.find(e => e.id === 'm1');
    assert.ok(monster.currentHp < 20, `expected the goblin to take damage, still at ${monster.currentHp}`);
    assert.equal(update.log.at(-1).message.startsWith('Alice attacks Goblin'), true);
  });

  test('a monster attacking a PC persists the new HP to the real characters table', async () => {
    upsertCharacter(db, campaignId, 'uid-alice', {
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, ac: 1, currentHp: 25, maxHp: 25, maxHpEffective: 25,
    });
    const dm = await connectAs('uid-dm', 'dm');
    const roster = [{ id: 'p1', kind: 'pc', name: 'Alice', accountUid: 'uid-alice' }, SURE_HIT_MONSTER];
    send(dm, { type: 'push_combat_state', roster, active: true, roundNumber: 1 });
    await nextNonRosterMessage(dm.next);

    const update = await attackUntilHit(dm, dm.next, 'm1', 'p1');
    const pcEntry = update.roster.find(e => e.id === 'p1');
    assert.ok(pcEntry.currentHp < 25, `expected Alice to take damage, still at ${pcEntry.currentHp}`);

    // The real persisted record, not just the broadcast payload -- confirms this actually wrote
    // through to the characters table (the single source of truth for a PC's HP), not just the
    // in-memory roster.
    const character = getCharacter(db, campaignId, 'uid-alice');
    assert.equal(character.currentHp, pcEntry.currentHp);
  });

  test('damage never drops a combatant\'s HP below 0', async () => {
    upsertCharacter(db, campaignId, 'uid-alice', {
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, ac: 1, currentHp: 1, maxHp: 25, maxHpEffective: 25,
    });
    const dm = await connectAs('uid-dm', 'dm');
    const roster = [{ id: 'p1', kind: 'pc', name: 'Alice', accountUid: 'uid-alice' }, SURE_HIT_MONSTER];
    send(dm, { type: 'push_combat_state', roster, active: true, roundNumber: 1 });
    await nextNonRosterMessage(dm.next);

    const update = await attackUntilHit(dm, dm.next, 'm1', 'p1');
    const pcEntry = update.roster.find(e => e.id === 'p1');
    assert.equal(pcEntry.currentHp, 0);
  });

  test('attacking with an unknown attacker or target id returns an error, not a crash', async () => {
    const dm = await connectAs('uid-dm', 'dm');
    send(dm, { type: 'push_combat_state', roster: [SURE_HIT_MONSTER], active: true, roundNumber: 1 });
    await nextNonRosterMessage(dm.next);

    send(dm, { type: 'combat_attack', attackerId: 'nonexistent', targetId: 'm1' });
    const msg = await nextNonRosterMessage(dm.next);
    assert.equal(msg.type, 'error');
  });

  test('a player (not just the DM) can trigger a combat_attack for their own PC', async () => {
    upsertCharacter(db, campaignId, 'uid-alice', {
      abilityScores: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 5, ac: 15, currentHp: 25, maxHp: 25, maxHpEffective: 25,
    });
    const player = await connectAs('uid-alice', 'player');
    const dm = await connectAs('uid-dm', 'dm');
    const roster = [{ id: 'p1', kind: 'pc', name: 'Alice', accountUid: 'uid-alice' }, { ...SURE_HIT_MONSTER, ac: 1 }];
    send(dm, { type: 'push_combat_state', roster, active: true, roundNumber: 1 });
    await nextNonRosterMessage(dm.next);
    await nextNonRosterMessage(player.next);

    const update = await attackUntilHit(player, dm.next, 'p1', 'm1');
    const monster = update.roster.find(e => e.id === 'm1');
    assert.ok(monster.currentHp < 20);
  });
});
