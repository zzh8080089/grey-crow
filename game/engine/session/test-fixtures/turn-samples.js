'use strict';

// Synthetic local-only adventure. These are hand-authored expectations, not
// snapshots produced by the implementation under test.
function identity(databasePath) {
  return { databasePath, adventureId: 'test-adventure', locale: 'zh-CN', contentVersion: 'test-v1' };
}

function request(overrides = {}) {
  return {
    actionId: 'borrow-rice', baseRevision: 0, input: '我问陈姨能不能借两袋米，答应明天归还。',
    locale: 'zh-CN', contentVersion: 'test-v1', ...overrides,
  };
}

function initialState() {
  const entity = (id, kind, name, visibility = 'player') => ({ id, kind, name, aliases: [], visibility, attributes: {} });
  return {
    entities: {
      p: entity('p', 'character', '玩家'),
      npc: { ...entity('npc', 'character', '陈姨'), aliases: ['隔壁邻居'] },
      home: entity('home', 'location', '楼道'),
      rice: entity('rice', 'item', '袋装米'),
      secret: entity('secret', 'character', '尚未露面的访客', 'hidden'),
      hidden_key: entity('hidden_key', 'item', '未发现的钥匙', 'hidden'),
    },
    inventory: [
      { ownerId: 'npc', itemId: 'rice', quantity: 3 },
      { ownerId: 'p', itemId: 'hidden_key', quantity: 1 },
    ],
    commitments: {},
    situation: { playerId: 'p', locationId: 'home', day: 10 },
  };
}

// Use only when this synthetic scene establishes a changed bodily condition.
// An ordinary action or pose does not require a condition event.
function playerConditionEvent(conditionText, evidence, playerId = 'p', id = 'player-condition', basis = 'observed') {
  return { id, type: 'condition.add', sourceSegmentIds: [...new Set(evidence.map(source => source.segmentId))],
    data: { characterId: playerId, basis, text: conditionText, evidence: structuredClone(evidence) } };
}

function borrowBundle({ quantity = 2 } = {}) {
  return {
    narration: [{ id: 'borrow-text', text: '陈姨递给你两袋米。你接过米，答应明天归还。' }],
    events: [
      { id: 'borrow-transfer', type: 'inventory.transfer', sourceSegmentIds: ['borrow-text'], data: { fromId: 'npc', toId: 'p', itemId: 'rice', quantity } },
      { id: 'borrow-promise', type: 'commitment.create', sourceSegmentIds: ['borrow-text'], data: { commitment: { id: 'rice-promise', debtorId: 'p', creditorId: 'npc', itemId: 'rice', quantity, due: '第十一天', status: 'open' } } },
    ],
    experiences: [{ id: 'borrow-memory', text: '陈姨借给你两袋米；你约定次日归还。', entityIds: ['p', 'npc', 'rice'], eventIds: ['borrow-transfer', 'borrow-promise'], sourceSegmentIds: ['borrow-text'], kind: 'event', knownBy: ['p', 'npc'] }],
  };
}

function returnBundle() {
  return {
    narration: [{ id: 'return-text', text: '你把两袋米还给陈姨。她点了点头，这笔借米的约定已经履行。' }],
    events: [
      { id: 'return-transfer', type: 'inventory.transfer', sourceSegmentIds: ['return-text'], data: { fromId: 'p', toId: 'npc', itemId: 'rice', quantity: 2 } },
      { id: 'return-promise', type: 'commitment.resolve', sourceSegmentIds: ['return-text'], data: { id: 'rice-promise', status: 'fulfilled' } },
    ],
    experiences: [{ id: 'return-memory', text: '你将此前借来的两袋米还给陈姨。', entityIds: ['p', 'npc', 'rice'], eventIds: ['return-transfer', 'return-promise'], sourceSegmentIds: ['return-text'], kind: 'event', knownBy: ['p', 'npc'] }],
  };
}

function refusedBundle() {
  return { narration: [{ id: 'refused-text', text: '你没借到米；陈姨摇了摇头，把米留在自己身边。' }],
    events: [], experiences: [] };
}

function assertBorrowed(assert, view) {
  assert.equal(view.adventureId, 'test-adventure');
  assert.equal(view.locale, 'zh-CN');
  assert.equal(view.contentVersion, 'test-v1');
  assert.deepEqual(view.state.inventory, [{ ownerId: 'p', itemId: 'rice', quantity: 2 }]);
  assert.deepEqual(view.state.commitments['rice-promise'], {
    id: 'rice-promise', debtorId: 'p', creditorId: 'npc', itemId: 'rice', quantity: 2, due: '第十一天', status: 'open',
  });
  assert.deepEqual(view.narration, [{ id: 'borrow-text', text: '陈姨递给你两袋米。你接过米，答应明天归还。' }]);
}

function assertReturned(assert, view) {
  assert.deepEqual(view.state.inventory, []);
  assert.equal(view.state.commitments['rice-promise'].status, 'fulfilled');
  assert.deepEqual(view.narration, [{ id: 'return-text', text: '你把两袋米还给陈姨。她点了点头，这笔借米的约定已经履行。' }]);
}

function assertHidden(assert, view) {
  assert.equal(view.state.entities.secret, undefined);
  assert.equal(view.state.entities.hidden_key, undefined);
  assert.equal(view.state.inventory.some((holding) => holding.itemId === 'hidden_key'), false);
  assert.equal(view.state.inventory.some((holding) => holding.ownerId !== 'p'), false);
}

module.exports = { identity, request, initialState, borrowBundle, returnBundle, refusedBundle, playerConditionEvent, assertBorrowed, assertReturned, assertHidden };
