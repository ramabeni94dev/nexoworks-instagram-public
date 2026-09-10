import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRefreshCandidates } from '../lib/refresh-batch.mjs';

test('worker prioritizes requests and new profiles, waits six hours after ordinary attempts', () => {
  const now = Date.now();
  const ago = hours => new Date(now - hours * 3600000).toISOString();
  const widgets = [
    { id: 'old', createdAt: ago(48), lastAttemptAt: ago(8) },
    { id: 'recent', createdAt: ago(48), lastAttemptAt: ago(2) },
    { id: 'manual', createdAt: ago(48), lastAttemptAt: ago(2), refreshRequestedAt: ago(0.1) },
    { id: 'new', createdAt: ago(0) },
    { id: 'running', createdAt: ago(48), lastAttemptAt: ago(8), refreshLease: { expiresAt: now + 60000 } },
    { id: 'cooldown', createdAt: ago(48), lastAttemptAt: ago(0), refreshRequestedAt: ago(0) },
  ];
  assert.deepEqual(selectRefreshCandidates(widgets, { now }).map(widget => widget.id), ['manual', 'old', 'new']);
});
