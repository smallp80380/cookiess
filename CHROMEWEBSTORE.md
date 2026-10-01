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

Cookies may contain authentication data and personal information. The extension reads them locally to provide its single purpose. It does not collect, transmit, sell or use them for advertising. No cookie values are retained in extension storage or logs. Imported files are read locally; exported files/clipboard are controlled by the user. Theme is retained locally. No policy URL has been invented; if publishing later, host a policy matching these actual statements.

## Submission materials still needed for publication

Publisher account/authorization, hosted privacy policy URL, final store-sized screenshots and promotional assets, chosen category and localization, and manual release review in stable Chrome including incognito/minimum version. Current screenshots are synthetic test-popup evidence, not a claim of completed Store review. No publication or account operation was performed.
