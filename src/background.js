import { compareText, normalizeRevisions, parseGitHubIssueUrl } from './core.mjs';

const GRAPHQL_URL = 'https://api.github.com/graphql';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message || 'Đã xảy ra lỗi không xác định.'
      }
    }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'LOAD_REVISIONS':
      return loadRevisions(message.url);
    case 'COMPARE_TEXT':
      return compareText(message.oldText, message.newText, {
        ignoreWhitespace: Boolean(message.ignoreWhitespace)
      });
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { opened: true };
    default:
      throw Object.assign(new Error('Message type không được hỗ trợ.'), { code: 'BAD_MESSAGE' });
  }
}

async function getToken() {
  const session = await chrome.storage.session.get('githubToken');
  if (session.githubToken) return session.githubToken;
  const local = await chrome.storage.local.get('githubToken');
  return local.githubToken || null;
}

async function loadRevisions(url) {
  const target = parseGitHubIssueUrl(url);
  const token = await getToken();
  if (!token) {
    throw Object.assign(
      new Error('Chưa cấu hình GitHub token. Mở Settings của extension để nhập fine-grained PAT.'),
      { code: 'TOKEN_REQUIRED' }
    );
  }

  const query = `
    query TicketRevisionHistory($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          number
          body
          createdAt
          updatedAt
          lastEditedAt
          includesCreatedEdit
          author { login }
          editor { login }
          userContentEdits(first: 100) {
            nodes {
              id
              editedAt
              diff
              editor { login }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json'
    },
    body: JSON.stringify({
      query,
      variables: {
        owner: target.owner,
        repo: target.repo,
        number: target.issueNumber
      }
    })
  });

  if (response.status === 401) {
    throw Object.assign(new Error('GitHub token không hợp lệ hoặc đã hết hạn.'), { code: 'AUTH_FAILED' });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`GitHub API trả về HTTP ${response.status}.`), { code: 'API_ERROR' });
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw Object.assign(new Error(payload.errors.map((item) => item.message).join('; ')), { code: 'GRAPHQL_ERROR' });
  }

  const issue = payload.data?.repository?.issue;
  if (!issue) {
    throw Object.assign(new Error('Không tìm thấy Issue hoặc token không có quyền đọc Issue này.'), { code: 'ISSUE_NOT_FOUND' });
  }

  const revisions = normalizeRevisions(issue);
  return {
    target,
    revisions,
    hasEditHistory: revisions.length > 1,
    originalAvailable: revisions.some((revision) => revision.isOriginal),
    currentIndex: revisions.findIndex((revision) => revision.isCurrent)
  };
}
