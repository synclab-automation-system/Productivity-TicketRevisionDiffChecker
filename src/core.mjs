export function parseGitHubIssueUrl(input) {
  const url = input instanceof URL ? input : new URL(input);
  if (url.hostname !== 'github.com') {
    throw new Error('Chỉ hỗ trợ github.com.');
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/);
  if (!match) {
    throw new Error('URL không phải GitHub Issue được hỗ trợ.');
  }
  return { owner: match[1], repo: match[2], issueNumber: Number(match[3]) };
}

export function normalizeRevisions(issue) {
  const nodes = Array.isArray(issue?.userContentEdits?.nodes)
    ? issue.userContentEdits.nodes
    : [];

  const snapshots = nodes
    .filter((node) => node && typeof node.diff === 'string' && node.editedAt)
    .map((node) => ({
      id: node.id || `edit-${node.editedAt}`,
      timestamp: node.editedAt,
      editor: node.editor?.login || null,
      text: node.diff,
      isOriginal: false,
      isCurrent: false,
      source: 'edit'
    }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (issue?.includesCreatedEdit && snapshots.length > 0) {
    snapshots[0].isOriginal = true;
  }

  const currentBody = typeof issue?.body === 'string' ? issue.body : '';
  const latest = snapshots.at(-1);
  if (latest && latest.text === currentBody) {
    latest.isCurrent = true;
  } else {
    snapshots.push({
      id: `current-${issue?.updatedAt || Date.now()}`,
      timestamp: issue?.lastEditedAt || issue?.updatedAt || issue?.createdAt || new Date().toISOString(),
      editor: issue?.editor?.login || issue?.author?.login || null,
      text: currentBody,
      isOriginal: snapshots.length === 0,
      isCurrent: true,
      source: 'current'
    });
  }

  if (snapshots.length === 1) {
    snapshots[0].isOriginal = true;
    snapshots[0].isCurrent = true;
  }

  return snapshots.map((revision, index) => ({
    ...revision,
    index,
    label: buildRevisionLabel(revision, index, snapshots.length)
  }));
}

function buildRevisionLabel(revision, index, total) {
  const flags = [];
  if (revision.isOriginal) flags.push('Original');
  if (revision.isCurrent) flags.push('Current');
  const version = `V${index + 1}/${total}`;
  const actor = revision.editor ? ` · @${revision.editor}` : '';
  const when = revision.timestamp ? ` · ${formatTimestamp(revision.timestamp)}` : '';
  return `${flags.length ? `${flags.join(' / ')} · ` : ''}${version}${actor}${when}`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

export function getShortcutSelection(revisions, shortcut) {
  if (!Array.isArray(revisions) || revisions.length < 2) return null;
  const currentIndex = revisions.findIndex((revision) => revision.isCurrent);
  if (currentIndex < 0) return null;

  if (shortcut === 'previous-current') {
    if (currentIndex === 0) return null;
    return { a: currentIndex - 1, b: currentIndex };
  }

  if (shortcut === 'original-current') {
    const originalIndex = revisions.findIndex((revision) => revision.isOriginal);
    if (originalIndex < 0 || originalIndex === currentIndex) return null;
    return { a: originalIndex, b: currentIndex };
  }

  return null;
}

function normalizeLineForCompare(line, ignoreWhitespace) {
  if (!ignoreWhitespace) return line;
  return line.trim().replace(/\s+/g, ' ');
}

function splitLines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n');
}

function lcsOperations(left, right, equals) {
  const n = left.length;
  const m = right.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = equals(left[i], right[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(left[i], right[j])) {
      operations.push({ type: 'equal', left: left[i], right: right[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({ type: 'delete', left: left[i], right: null });
      i += 1;
    } else {
      operations.push({ type: 'insert', left: null, right: right[j] });
      j += 1;
    }
  }

  while (i < n) {
    operations.push({ type: 'delete', left: left[i], right: null });
    i += 1;
  }
  while (j < m) {
    operations.push({ type: 'insert', left: null, right: right[j] });
    j += 1;
  }
  return operations;
}

function tokenize(line) {
  if (!line) return [];
  return line.match(/\s+|[^\s]+/g) || [];
}

export function diffTokens(oldLine, newLine) {
  const left = tokenize(oldLine);
  const right = tokenize(newLine);
  const operations = lcsOperations(left, right, (a, b) => a === b);
  return operations.map((op) => {
    if (op.type === 'equal') return { type: 'equal', old: op.left, new: op.right };
    if (op.type === 'delete') return { type: 'delete', old: op.left, new: null };
    return { type: 'insert', old: null, new: op.right };
  });
}

export function compareText(oldText, newText, { ignoreWhitespace = false } = {}) {
  const left = splitLines(oldText);
  const right = splitLines(newText);
  const operations = lcsOperations(
    left,
    right,
    (a, b) => normalizeLineForCompare(a, ignoreWhitespace) === normalizeLineForCompare(b, ignoreWhitespace)
  );

  const rows = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (let cursor = 0; cursor < operations.length;) {
    const op = operations[cursor];
    if (op.type === 'equal') {
      rows.push({
        type: 'equal',
        oldLineNumber,
        newLineNumber,
        oldText: op.left,
        newText: op.right,
        oldTokens: null,
        newTokens: null
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      cursor += 1;
      continue;
    }

    const deleted = [];
    const inserted = [];
    while (cursor < operations.length && operations[cursor].type !== 'equal') {
      const change = operations[cursor];
      if (change.type === 'delete') deleted.push(change.left);
      if (change.type === 'insert') inserted.push(change.right);
      cursor += 1;
    }

    const count = Math.max(deleted.length, inserted.length);
    for (let index = 0; index < count; index += 1) {
      const oldLine = index < deleted.length ? deleted[index] : null;
      const newLine = index < inserted.length ? inserted[index] : null;
      const paired = oldLine !== null && newLine !== null;
      const tokenDiff = paired ? diffTokens(oldLine, newLine) : [];

      rows.push({
        type: paired ? 'change' : oldLine !== null ? 'delete' : 'insert',
        oldLineNumber: oldLine !== null ? oldLineNumber++ : null,
        newLineNumber: newLine !== null ? newLineNumber++ : null,
        oldText: oldLine,
        newText: newLine,
        oldTokens: paired
          ? tokenDiff.filter((token) => token.old !== null).map((token) => ({ text: token.old, changed: token.type === 'delete' }))
          : null,
        newTokens: paired
          ? tokenDiff.filter((token) => token.new !== null).map((token) => ({ text: token.new, changed: token.type === 'insert' }))
          : null
      });
    }
  }

  const stats = rows.reduce(
    (acc, row) => {
      if (row.type === 'insert') acc.added += 1;
      if (row.type === 'delete') acc.deleted += 1;
      if (row.type === 'change') {
        acc.added += 1;
        acc.deleted += 1;
        acc.changed += 1;
      }
      return acc;
    },
    { added: 0, deleted: 0, changed: 0 }
  );

  return { rows, stats, ignoreWhitespace };
}
