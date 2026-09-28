const tokenInput = document.getElementById('token');
const rememberInput = document.getElementById('remember');
const status = document.getElementById('status');

async function load() {
  const [session, local] = await Promise.all([
    chrome.storage.session.get('githubToken'),
    chrome.storage.local.get(['githubToken', 'rememberToken'])
  ]);
  const token = session.githubToken || local.githubToken || '';
  tokenInput.value = token;
  rememberInput.checked = Boolean(local.rememberToken && local.githubToken);
  if (token) setStatus('Token đã được cấu hình.', 'ok');
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

document.getElementById('save').addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('Nhập GitHub token trước khi Save.', 'error');
    return;
  }
  if (rememberInput.checked) {
    await chrome.storage.local.set({ githubToken: token, rememberToken: true });
    await chrome.storage.session.remove('githubToken');
  } else {
    await chrome.storage.session.set({ githubToken: token });
    await chrome.storage.local.remove(['githubToken', 'rememberToken']);
  }
  setStatus('Đã lưu token.', 'ok');
});

document.getElementById('clear').addEventListener('click', async () => {
  await Promise.all([
    chrome.storage.session.remove('githubToken'),
    chrome.storage.local.remove(['githubToken', 'rememberToken'])
  ]);
  tokenInput.value = '';
  rememberInput.checked = false;
  setStatus('Đã xóa token.', 'ok');
});

load().catch((error) => setStatus(error.message, 'error'));
