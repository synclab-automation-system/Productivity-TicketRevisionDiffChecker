import test from 'node:test';
import assert from 'node:assert/strict';
import { compareText, getShortcutSelection, normalizeRevisions, parseGitHubIssueUrl } from '../src/core.mjs';

test('parseGitHubIssueUrl extracts owner repo issue', () => {
  assert.deepEqual(
    parseGitHubIssueUrl('https://github.com/acme/widgets/issues/42?x=1'),
    { owner: 'acme', repo: 'widgets', issueNumber: 42 }
  );
});

test('parseGitHubIssueUrl rejects unsupported URL', () => {
  assert.throws(() => parseGitHubIssueUrl('https://github.com/acme/widgets/pull/42'));
});

test('normalizeRevisions sorts snapshots and marks original/current', () => {
  const revisions = normalizeRevisions({
    body: 'three',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    includesCreatedEdit: true,
    userContentEdits: {
      nodes: [
        { id: '3', editedAt: '2026-01-03T00:00:00Z', diff: 'three', editor: { login: 'c' } },
        { id: '1', editedAt: '2026-01-01T00:00:00Z', diff: 'one', editor: { login: 'a' } },
        { id: '2', editedAt: '2026-01-02T00:00:00Z', diff: 'two', editor: { login: 'b' } }
      ]
    }
  });
  assert.deepEqual(revisions.map((item) => item.text), ['one', 'two', 'three']);
  assert.equal(revisions[0].isOriginal, true);
  assert.equal(revisions[2].isCurrent, true);
});

test('normalizeRevisions appends synthetic current when current body is newer than history', () => {
  const revisions = normalizeRevisions({
    body: 'current',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    includesCreatedEdit: false,
    userContentEdits: {
      nodes: [{ id: '1', editedAt: '2026-01-02T00:00:00Z', diff: 'older', editor: null }]
    }
  });
  assert.equal(revisions.length, 2);
  assert.equal(revisions[1].text, 'current');
  assert.equal(revisions[1].isCurrent, true);
});

test('compareText reports add/delete/change', () => {
  const result = compareText('a\nb\nc', 'a\nb changed\nd');
  assert.equal(result.stats.deleted, 2);
  assert.equal(result.stats.added, 2);
  assert.equal(result.stats.changed, 2);
  assert.ok(result.rows.some((row) => row.type === 'change'));
});

test('reverse comparison reverses pure addition/deletion', () => {
  const forward = compareText('a', 'a\nb');
  const reverse = compareText('a\nb', 'a');
  assert.equal(forward.stats.added, 1);
  assert.equal(forward.stats.deleted, 0);
  assert.equal(reverse.stats.added, 0);
  assert.equal(reverse.stats.deleted, 1);
});

test('ignore whitespace treats normalized lines as equal', () => {
  const strict = compareText('hello   world', ' hello world ');
  const ignored = compareText('hello   world', ' hello world ', { ignoreWhitespace: true });
  assert.ok(strict.stats.added > 0 || strict.stats.deleted > 0);
  assert.deepEqual(ignored.stats, { added: 0, deleted: 0, changed: 0 });
});

test('shortcut selections resolve previous/current and original/current', () => {
  const revisions = [
    { isOriginal: true, isCurrent: false },
    { isOriginal: false, isCurrent: false },
    { isOriginal: false, isCurrent: true }
  ];
  assert.deepEqual(getShortcutSelection(revisions, 'previous-current'), { a: 1, b: 2 });
  assert.deepEqual(getShortcutSelection(revisions, 'original-current'), { a: 0, b: 2 });
});
