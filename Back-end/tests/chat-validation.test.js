import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCollection } from '../validation.js';

const message = { id: 'MSG-test', channel: 'general', fromKey: 'user:1', fromName: 'Test User', fromRole: 'Admin', text: 'Salom', createdAt: '2026-11-06T10:00:00.000Z', readBy: [], reactions: {} };

test('chat rejects payloads that break dates, rendering, readers or reactions', () => {
  assert.doesNotThrow(() => validateCollection('edu-chat-v1', [message]));
  for (const change of [
    { text: {} }, { text: '   ' }, { text: 'a'.repeat(10_001) },
    { createdAt: 'invalid-date' }, { createdAt: null },
    { fromName: {} }, { channel: 42 },
    { readBy: 'user:1' }, { readBy: [null] }, { readBy: ['user:1', 'user:1'] },
    { reactions: [] }, { reactions: { '👍': 'user:1' } },
    { reactions: { '👍': [{}] } }, { replyToId: {} },
  ]) {
    assert.throws(() => validateCollection('edu-chat-v1', [{ ...message, ...change }]), (error) => error.status === 400);
  }
  assert.doesNotThrow(() => validateCollection('edu-chat-v1', [{ ...message, readBy: ['user:2'], reactions: { '👍': ['user:2'] } }]));
});
