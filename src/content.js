(() => {
  const BUTTON_ID = 'trdc-compare-button';
  const MODAL_ID = 'trdc-modal-root';
  let mountedUrl = null;
  let observer = null;
  let scheduled = false;

  function isIssueUrl(url = location.href) {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function findIssueBody() {
    const selectors = [
      '[data-testid="issue-body"]',
      '[data-testid="issue-viewer-container"] .markdown-body',
      '.js-issue-body',
      '.timeline-comment-group:first-of-type .comment-body .markdown-body'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function ensureButton() {
    if (!isIssueUrl()) {
      removeInjectedUi();
      mountedUrl = location.href;
      return;
    }

    if (document.getElementById(BUTTON_ID)) {
      mountedUrl = location.href;
      return;
    }

    const issueBody = findIssueBody();
    if (!issueBody?.parentElement) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'trdc-toolbar';
    toolbar.dataset.trdcToolbar = 'true';

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'trdc-button';
    button.dataset.trdcButton = 'true';
    button.textContent = 'Compare revisions';
    button.addEventListener('click', openComparisonModal);

    toolbar.appendChild(button);
    issueBody.parentElement.insertBefore(toolbar, issueBody);
    mountedUrl = location.href;
  }

  function removeInjectedUi() {
    document.querySelector('[data-trdc-toolbar="true"]')?.remove();
    document.getElementById(MODAL_ID)?.remove();
  }

  function watchNavigation() {
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        if (mountedUrl !== location.href) {
          removeInjectedUi();
          mountedUrl = null;
        }
        ensureButton();
      });
    };

    document.addEventListener('turbo:load', schedule);
    window.addEventListener('popstate', schedule);
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error?.message || 'Extension request failed.');
          error.code = response?.error?.code;
          reject(error);
          return;
        }
        resolve(response.result);
      });
    });
  }

  async function openComparisonModal() {
    document.getElementById(MODAL_ID)?.remove();

    const root = createElement('div', 'trdc-modal-root');
    root.id = MODAL_ID;
    root.dataset.trdcModal = 'true';
    const backdrop = createElement('div', 'trdc-backdrop');
    const panel = createElement('section', 'trdc-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Compare GitHub Issue revisions');

    const header = createElement('header', 'trdc-header');
    const titleWrap = createElement('div');
    titleWrap.append(
      createElement('h2', 'trdc-title', 'Compare revisions'),
      createElement('p', 'trdc-subtitle', 'Raw text của GitHub Issue description')
    );
    const close = createElement('button', 'trdc-icon-button', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => root.remove());
    header.append(titleWrap, close);

    const body = createElement('div', 'trdc-body');
    body.append(createElement('div', 'trdc-state', 'Đang tải revision history…'));

    panel.append(header, body);
    root.append(backdrop, panel);
    document.body.append(root);
    backdrop.addEventListener('click', () => root.remove());

    try {
      const data = await send({ type: 'LOAD_REVISIONS', url: location.href });
      renderComparisonUi(body, data);
    } catch (error) {
      renderError(body, error);
    }
  }

  function renderError(container, error) {
    container.replaceChildren();
    const box = createElement('div', 'trdc-error');
    box.append(
      createElement('strong', null, 'Không thể tải revision history'),
      createElement('p', null, error.message)
    );
    if (error.code === 'TOKEN_REQUIRED' || error.code === 'AUTH_FAILED') {
      const settings = createElement('button', 'trdc-button', 'Mở Settings');
      settings.type = 'button';
      settings.addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }).catch(() => {}));
      box.append(settings);
    }
    container.append(box);
  }

  function renderComparisonUi(container, data) {
    container.replaceChildren();
    const revisions = data.revisions || [];
    if (revisions.length < 2) {
      const empty = createElement('div', 'trdc-empty');
      empty.append(
        createElement('strong', null, 'Issue chưa có revision để so sánh'),
        createElement('p', null, 'Description hiện chỉ có một version khả dụng.')
      );
      container.append(empty);
      return;
    }

    const controls = createElement('div', 'trdc-controls');
    const selectors = createElement('div', 'trdc-selectors');

    const fieldA = createSelectField('Version A', revisions);
    const swap = createElement('button', 'trdc-icon-button trdc-swap', '⇄');
    swap.type = 'button';
    swap.title = 'Swap A/B';
    swap.dataset.trdcSwap = 'true';
    const fieldB = createSelectField('Version B', revisions);
    selectors.append(fieldA.wrapper, swap, fieldB.wrapper);

    const actions = createElement('div', 'trdc-actions');
    const previousCurrent = createElement('button', 'trdc-secondary-button', 'Previous ↔ Current');
    previousCurrent.type = 'button';
    const originalCurrent = createElement('button', 'trdc-secondary-button', 'Original ↔ Current');
    originalCurrent.type = 'button';
    const sideBySide = createElement('button', 'trdc-view-button is-active', 'Side-by-side');
    sideBySide.type = 'button';
    sideBySide.dataset.view = 'side';
    const unified = createElement('button', 'trdc-view-button', 'Unified');
    unified.type = 'button';
    unified.dataset.view = 'unified';
    const ignoreLabel = createElement('label', 'trdc-checkbox');
    const ignoreWhitespace = document.createElement('input');
    ignoreWhitespace.type = 'checkbox';
    ignoreWhitespace.dataset.trdcIgnoreWhitespace = 'true';
    ignoreLabel.append(ignoreWhitespace, document.createTextNode('Ignore whitespace'));
    actions.append(previousCurrent, originalCurrent, sideBySide, unified, ignoreLabel);

    const stats = createElement('div', 'trdc-stats');
    const diff = createElement('div', 'trdc-diff');
    diff.dataset.trdcDiff = 'true';
    controls.append(selectors, actions);
    container.append(controls, stats, diff);

    let view = 'side';
    const currentIndex = revisions.findIndex((revision) => revision.isCurrent);
    const originalIndex = revisions.findIndex((revision) => revision.isOriginal);
    fieldA.select.value = String(Math.max(0, currentIndex - 1));
    fieldB.select.value = String(currentIndex >= 0 ? currentIndex : revisions.length - 1);

    previousCurrent.disabled = currentIndex <= 0;
    originalCurrent.disabled = originalIndex < 0 || currentIndex < 0 || originalIndex === currentIndex;

    const render = async () => {
      const a = Number(fieldA.select.value);
      const b = Number(fieldB.select.value);
      if (!Number.isInteger(a) || !Number.isInteger(b) || !revisions[a] || !revisions[b]) return;
      diff.replaceChildren(createElement('div', 'trdc-state', 'Đang tạo diff…'));
      try {
        const result = await send({
          type: 'COMPARE_TEXT',
          oldText: revisions[a].text,
          newText: revisions[b].text,
          ignoreWhitespace: ignoreWhitespace.checked
        });
        stats.textContent = `-${result.stats.deleted}  +${result.stats.added}${result.stats.changed ? `  · ${result.stats.changed} changed` : ''}`;
        if (view === 'side') renderSideBySide(diff, result.rows);
        else renderUnified(diff, result.rows);
      } catch (error) {
        renderError(diff, error);
      }
    };

    fieldA.select.addEventListener('change', render);
    fieldB.select.addEventListener('change', render);
    ignoreWhitespace.addEventListener('change', render);
    swap.addEventListener('click', () => {
      const value = fieldA.select.value;
      fieldA.select.value = fieldB.select.value;
      fieldB.select.value = value;
      render();
    });
    previousCurrent.addEventListener('click', () => {
      fieldA.select.value = String(currentIndex - 1);
      fieldB.select.value = String(currentIndex);
      render();
    });
    originalCurrent.addEventListener('click', () => {
      fieldA.select.value = String(originalIndex);
      fieldB.select.value = String(currentIndex);
      render();
    });
    sideBySide.addEventListener('click', () => {
      view = 'side';
      sideBySide.classList.add('is-active');
      unified.classList.remove('is-active');
      render();
    });
    unified.addEventListener('click', () => {
      view = 'unified';
      unified.classList.add('is-active');
      sideBySide.classList.remove('is-active');
      render();
    });
    render();
  }

  function createSelectField(labelText, revisions) {
    const wrapper = createElement('label', 'trdc-field');
    wrapper.append(createElement('span', 'trdc-field-label', labelText));
    const select = document.createElement('select');
    select.className = 'trdc-select';
    revisions.forEach((revision, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = revision.label;
      select.append(option);
    });
    wrapper.append(select);
    return { wrapper, select };
  }

  function appendTokens(target, tokens, changedClass) {
    if (!tokens) return;
    tokens.forEach((token) => {
      const span = document.createElement('span');
      span.textContent = token.text;
      if (token.changed) span.className = changedClass;
      target.append(span);
    });
  }

  function renderSideBySide(container, rows) {
    container.replaceChildren();
    const table = createElement('div', 'trdc-side-table');
    rows.forEach((row) => {
      const line = createElement('div', `trdc-side-row trdc-${row.type}`);
      const oldNumber = createElement('div', 'trdc-line-number', row.oldLineNumber ?? '');
      const oldCode = createElement('pre', 'trdc-code trdc-old-code');
      const newNumber = createElement('div', 'trdc-line-number', row.newLineNumber ?? '');
      const newCode = createElement('pre', 'trdc-code trdc-new-code');

      if (row.oldTokens) appendTokens(oldCode, row.oldTokens, 'trdc-inline-delete');
      else oldCode.textContent = row.oldText ?? '';
      if (row.newTokens) appendTokens(newCode, row.newTokens, 'trdc-inline-insert');
      else newCode.textContent = row.newText ?? '';

      line.append(oldNumber, oldCode, newNumber, newCode);
      table.append(line);
    });
    container.append(table);
  }

  function renderUnified(container, rows) {
    container.replaceChildren();
    const table = createElement('div', 'trdc-unified-table');
    rows.forEach((row) => {
      if (row.type === 'change') {
        table.append(
          unifiedLine('delete', row.oldLineNumber, null, '-', row.oldText ?? '', row.oldTokens),
          unifiedLine('insert', null, row.newLineNumber, '+', row.newText ?? '', row.newTokens)
        );
        return;
      }
      if (row.type === 'delete') {
        table.append(unifiedLine('delete', row.oldLineNumber, null, '-', row.oldText ?? '', null));
        return;
      }
      if (row.type === 'insert') {
        table.append(unifiedLine('insert', null, row.newLineNumber, '+', row.newText ?? '', null));
        return;
      }
      table.append(unifiedLine('equal', row.oldLineNumber, row.newLineNumber, ' ', row.oldText ?? '', null));
    });
    container.append(table);
  }

  function unifiedLine(type, oldNumber, newNumber, prefix, text, tokens) {
    const line = createElement('div', `trdc-unified-row trdc-${type}`);
    line.append(
      createElement('div', 'trdc-line-number', oldNumber ?? ''),
      createElement('div', 'trdc-line-number', newNumber ?? ''),
      createElement('div', 'trdc-prefix', prefix)
    );
    const code = createElement('pre', 'trdc-code');
    if (tokens) appendTokens(code, tokens, type === 'delete' ? 'trdc-inline-delete' : 'trdc-inline-insert');
    else code.textContent = text;
    line.append(code);
    return line;
  }

  watchNavigation();

  window.addEventListener('beforeunload', () => observer?.disconnect(), { once: true });
})();
