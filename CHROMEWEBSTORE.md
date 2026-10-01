# Chrome Web Store preparation (not published)

## Single purpose
Manage cookies applicable to the active website: view, create, edit, delete, and locally import/export them. Product name: Cookiess. Version: 1.0.0. Minimum Chrome: 132. Main language: Russian.

## Proposed listing

Cookiess — компактный локальный менеджер cookies текущего сайта. Поиск и выбор записей, редактор атрибутов, импорт с предпросмотром и экспорт JSON/cookies.txt. Светлая и тёмная тема. Доступ выдаётся пользователем для выбранных сайтов.

## Permissions justification

- `cookies`: required for real cookie data including HttpOnly, full attributes, partitions and mutations.
- `activeTab`: read the active URL after the user invokes the action without broad tabs/history access.
- `storage`: persist theme only; no cookie values.
- `optional_host_permissions: *://*/*`: makes HTTP/HTTPS host consent available. Actual request covers current registrable domain and its subdomains to include applicable parent-domain cookies. IP/localhost requests are exact. Runtime domain/hostOnly filtering prevents sibling-site operations; top-level partition and active store filter apply independently.

No backend, analytics, ads, remote code, content scripts or AI service. No history/webRequest/debugger/tabs permission. No background service worker. Clipboard/export are explicit user actions, no downloads or clipboard permission requested.

## Data handling declaration

Cookies may contain authentication data and personal information. The extension reads them locally to provide its single purpose. It does not collect, transmit, sell or use them for advertising. No cookie values are retained in extension storage or logs. Imported files are read locally; exported files/clipboard are controlled by the user. Theme is retained locally. Policy source: [PRIVACY.md](PRIVACY.md). Public policy page: https://smallp80380.github.io/cookiess/ (deployment is verified separately before entering the URL in the dashboard).

## Prepared submission bundle

- Russian listing text and proposed category: [store/LISTING.md](store/LISTING.md).
- Four screenshots at 1280×800 and one promotional tile at 440×280: [store/assets](store/assets/). They compose unchanged real native-popup captures with explanatory copy; they are listing materials, not additional browser verification.
- Extension icon: `public/icons/128.png`; already present in the install ZIP.
- Bilingual privacy policy: [PRIVACY.md](PRIVACY.md), public HTML in `docs/index.html`.
- Review instructions and final manual checks: [store/REVIEW.md](store/REVIEW.md).
- Rebuild listing assets with `npm run store:assets` after installing Playwright Chromium (`npx playwright install chromium`), or set `CHROMIUM_PATH` to an installed browser. Asset generation uses no network resources.

Image dimensions and submission fields checked against [Chrome image guidance](https://developer.chrome.com/docs/webstore/images) and [privacy dashboard guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) on 2026-10-01.

## Remaining before submission

- Execute the pending stable Windows/macOS Chrome and minimum-version/manual clipboard/TXT checks in `store/REVIEW.md`. CI builds on these platforms do not verify native popup behavior there.
- Confirm publisher identity/account, exact dashboard category, policy URL and accurate privacy declarations.
- Obtain explicit authorization for Chrome Web Store submission and any account/payment operation. GitHub publication is authorized; Store submission has not occurred.
