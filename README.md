# Productivity - Ticket Revision Diff Checker

Browser extension (Chrome/Edge, Manifest V3) để so sánh **raw text** giữa hai revision của GitHub Issue description.

## MVP scope

- Inject nút **Compare revisions** trên GitHub Issue.
- Đọc revision history bằng GitHub GraphQL API chính thức.
- Chọn bất kỳ Version A / Version B.
- Side-by-side diff và Unified diff.
- Highlight line additions/deletions và phần text thay đổi trong line.
- Swap A/B.
- Ignore whitespace.
- Shortcut Previous ↔ Current và Original ↔ Current khi revision tương ứng khả dụng.
- Read-only, không chỉnh sửa GitHub Issue.
- Không backend, không semantic Markdown, không AI.

## Cấu trúc

```text
manifest.json
src/
  background.js   # GitHub GraphQL + compare message handling
  core.mjs        # URL parser, revision normalization, text diff engine
  content.js      # Inject button/modal vào GitHub Issue
  content.css
  options.html    # GitHub PAT settings
  options.js
  options.css
test/
  core.test.mjs
e2e/
  live-github.mjs # Real-browser smoke test với GitHub Issue thật
```

## Authentication

GitHub GraphQL API yêu cầu authentication.

Khuyến nghị dùng **fine-grained Personal Access Token**:

- Public repository: fine-grained PAT có quyền đọc public repository.
- Private repository: chọn repository cần dùng và cấp `Issues: Read-only`.

Extension không đọc GitHub session cookie và không dùng undocumented internal endpoint.

Mặc định token được lưu vào `chrome.storage.session`; nếu bật **Remember token**, token được lưu vào `chrome.storage.local` của extension.

## Load extension để test manual

1. Clone/download repository.
2. Mở `chrome://extensions` hoặc `edge://extensions`.
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn thư mục root của repository (thư mục chứa `manifest.json`).
6. Mở Extension details → **Extension options** và nhập GitHub fine-grained PAT.
7. Mở một GitHub Issue đã từng chỉnh sửa description.
8. Bấm **Compare revisions**.

## Unit tests

```bash
npm test
```

Unit test dùng Node built-in test runner, không cần dependency runtime.

## Real-browser E2E

```bash
npm install
npx playwright install chromium

E2E_GITHUB_ISSUE_URL='https://github.com/<owner>/<repo>/issues/<number>' \
GITHUB_TOKEN='github_pat_...' \
npm run test:e2e:live
```

Fixture phải là GitHub Issue thật có ít nhất hai revision description.

E2E sẽ load extension thật vào Chromium, cấu hình token trong session, mở Issue, kiểm tra nút Compare revisions, Version A/B, Side-by-side, Unified, Swap và Ignore whitespace.

## Revision model

GraphQL query lấy:

- current `body`;
- `createdAt`, `updatedAt`, `lastEditedAt`;
- `includesCreatedEdit`;
- `userContentEdits(first: 100) { nodes { id editedAt diff editor { login } } }`.

Các snapshot được sort theo `editedAt`. Current body được dùng để đảm bảo version hiện tại luôn có mặt; nếu snapshot mới nhất trùng current body thì không tạo duplicate.

Nếu GitHub không expose creation snapshot (`includesCreatedEdit = false`) thì shortcut **Original ↔ Current** không được enable thay vì tự suy đoán original text.

## Known limitations

- Chỉ xử lý tối đa 100 edit nodes trong MVP.
- Revision GitHub không còn expose thì extension không thể phục hồi.
- GitHub có thể thay đổi DOM; content script có fallback selector nhưng vẫn cần live browser E2E để phát hiện regression.
- Live E2E cần token và Issue fixture thật nên không chạy mặc định trong `npm test`.
