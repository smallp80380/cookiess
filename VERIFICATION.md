# Cookiess verification — 2026-10-01

## Delivered result

`dist/` is a real Manifest V3 extension. `artifacts/cookiess-1.0.0.zip` contains manifest.json at its root and exactly the nine dist files, with byte-for-byte equality verified. ZIP SHA256: `c417d67e63158f3d0b8991075ae4b66816647b0873c4de2d891a0a9c6a6460ee`.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, TypeScript 5.9.3 |
| `npm run lint` | Passed, ESLint + typescript-eslint |
| `npm test` | 20 tests passed in 3 files, Vitest 4.1.11 |
| `npm run build` / `npm run package` | Passed, Vite 7.3.6, manifest and referenced resources valid |
| `npm audit --json` | 0 vulnerabilities after upgrading Vitest |
| Real native popup suite | 20 checks passed, Chromium 154.0.8037.0 / Playwright 1.63.0 |
| ZIP contents and resource paths | Passed; every ZIP file compared to dist |
| Visual inspection | Native popup screenshots reviewed in light/dark, list/editor/import, empty state and incognito |
| Privacy/source inspection | Production modules contain no fetch/XHR/beacon/logging, remote script/font resources, backend or persistent cookie values |

Node 22.22.1. Tests ran entirely in Linux/WSL. Chromium was launched in a dedicated temporary profile under Xvfb, with original dist loaded unpacked. Developer mode was enabled in that synthetic profile for the incognito check. The browser profile was deleted after testing. No user browser profile, Windows installation, publication or paid service was used.

Actual native action targets were opened via CDP `Extensions.triggerAction`, attached through CDP, and interacted with through their DOM and native Chrome APIs. They were not mock web pages. All cookies were synthetic. HTTPS and the initial HTTP test documents were fulfilled through Playwright routing at their proper origins; no Chrome cookie API was mocked in the browser suite. The final incognito check used a real local HTTP server and a native Chrome incognito window (not a separate CDP BrowserContext without installed extensions).

## Browser coverage

Machine-readable results: [browser-results.json](screenshots/browser-results.json).

- Extension resources load; ordinary unsupported extension-tab state and native popup no-access state are distinct.
- Native consent denial does not masquerade as empty cookies. Approval immediately loads the list; reopened popup retains access.
- Host-only current-host and applicable parent-domain records on `/`, `/account`, `/private` are included. Parent host-only and sibling records are excluded.
- `cookies.onChanged` updates the list. Two same-name paths remain separate. Same domain/path/name host-only and domain cookies coexist and import as separate identity records.
- Current first-party partition is included; another top-level site and `hasCrossSiteAncestor: true` are excluded. Full partition key survives editing and JSON export.
- In Chromium 154, ordinary `getAll({storeId})` returned zero partitioned records. Top-frame `getPartitionKey` returned `topLevelSite: https://example.com`, `hasCrossSiteAncestor: false`. Evidence: [partition-behavior.json](screenshots/partition-behavior.json). Separate enumeration is required.
- Editor preserves session, HttpOnly and unspecified SameSite. Add creates persistent/Secure/None cookies and shows field validation. Dirty Cancel discards only after confirmation. Rename creates new identity and removes old one.
- `/account` duplicate deletion is refused while `/` also matches; no cookie changes. Selecting/deleting `/` then deleting `/account` affects only the intended records. Remove without selection disables selected removal; delete-all requires host/count confirmation and stays within scope.
- JSON export ignores search; a real downloaded JSON file was read back and compared to the expected count. Export refuses partition flattening to TXT. Clipboard/manual fallback was exercised; the unfocused automation context took the manual Ctrl+C path during visual inspection.
- Actual Cookie-Editor null storeId / null unspecified SameSite import works. Foreign domain is skipped; malformed record is invalid; an oversized valid-looking record is actually rejected by Chrome. Partial result reports one success, one skip and two errors. Replace and skip conflict policies work.
- Netscape HttpOnly/session/path import and local Cookiess JSON file import work.
- 233 visible cookies across unpartitioned and current-partition buckets fit the 460×590 popup without horizontal overflow. Long Unicode names/values and XSS-like strings remain text. Search-empty, themes and keyboard focus were checked.
- Navigation to a sibling host disables writes until explicit context refresh; the refreshed list has only records applicable to that host.
- Actual HTTP localhost and IPv4 cookie CRUD works with per-host consent and Secure off by default.
- Permission revocation disables writes and refresh returns to no-access.
- Native incognito popup uses store `1`, starts empty, creates/deletes its own cookie, and never changes normal store `0`. [incognito-empty.png](screenshots/incognito-empty.png) shows the actual reread result.

## Unit coverage

Domain matching, private/public suffix boundaries (`co.uk`, `github.io`), localhost/IP, full store/partition identity, invalid attribute combinations, three format round trips, empty values, CRLF/HttpOnly Netscape, TXT loss/refusal, malformed types/versions, XSS as text, unknown-field warnings, actual Cookie-Editor null conventions, denied access before partition lookup, stale navigation, safe writable fields, ambiguous deletion, conflict preview, host-only/domain coexistence, injected partial API failure and a conflict arriving after preview.

Cookie-Editor compatibility was checked against its [upstream JSON formatter](https://raw.githubusercontent.com/Moustachauve/cookie-editor/master/interface/lib/jsonFormat.js), without copying its source. APIs and test tooling were checked against [Chrome Cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [extension end-to-end guidance](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing), [Playwright extension guidance](https://playwright.dev/docs/chrome-extensions), and [curl's Netscape format](https://curl.se/docs/http-cookies.html).

## Screenshots

Only synthetic data; all main images are actual native popup captures:

- [Light list](screenshots/list-light.png), [dark list](screenshots/list-dark.png), [233 rows](screenshots/many-light.png).
- [Light editor](screenshots/editor-light.png), [dark editor](screenshots/editor-dark.png).
- [Light import error](screenshots/import-light.png), [dark import preview](screenshots/import-dark.png).
- [Permission state](screenshots/permission.png), [empty](screenshots/empty.png), [no results](screenshots/no-results-dark.png), [incognito](screenshots/incognito-empty.png).

## Limits and manual release checklist

- The browser exercised was Linux Chromium 154. Minimum Chrome 132 is chosen from the documented API availability; Chrome 132 and Windows/macOS stable Chrome were not separately executed.
- HTTPS documents used intercepted synthetic responses; real site's authentication restoration, live network/TLS/server cookie interactions and enterprise policies were not tested.
- Automatic system clipboard success is not claimed; manual fallback was verified. JSON native download was checked; TXT serialization/loss handling was unit-tested, not separately downloaded through native UI.
- No screen-reader audit or exhaustive concurrent site mutation stress test was run. Every mutation rechecks context and permission, but Chrome APIs cannot provide a transaction across tab navigation / external cookie updates.
- Some same-name domain/path combinations do not have a safe `cookies.remove` URL. They are deliberately refused. Identity replacement/import are non-atomic; partial results are surfaced. Browser expiry clamping is detected after write rather than reported as exact preservation.
- Closing the browser popup loses unsaved drafts. Internal navigation confirms dirty edits; the extension cannot keep Chrome's popup open after external dismissal.

Manual before a future Store release: load ZIP unpacked with Developer mode in stable Chrome; check consent, direct clipboard copying, JSON/TXT download, editor/keyboard, and Incognito (after explicitly enabling extension access) on synthetic sites. Confirm expected scope after navigating an active tab. Compare normal/private stores. Never use real account cookies in screenshots. Publication requires separate authorization; current CHROMEWEBSTORE.md is preparation only.

## Release readiness follow-up — 2026-10-01

- Added CI on Ubuntu, Windows and macOS for typecheck, lint, 20 unit tests, packaged build and exact ZIP/manifest resource validation. CI platform builds are separate from browser acceptance.
- Repeated native action-popup suite in isolated Linux Chrome for Testing 154.0.8037.92: all 20 checks passed, including native permission dialog, partial failure, current-partition scope and native incognito store. Latest screenshots/browser-results.json records this second run.
- Local typecheck, lint, 20 unit tests, build/package and scripts/verify-package.py passed.
- Store listing compositions were rendered from unchanged real synthetic native-popup captures. PNG dimensions are 1280×800 (four screenshots) and 440×280 (promo); these compositions do not count as extension behavior tests.
- Privacy page desktop/mobile layouts and support links checked in headless Chromium.
- MIT license added by explicit user choice; bilingual privacy policy, static public policy page and reviewer checklist prepared.
- Stable Windows/macOS browser behavior, Chrome 132, direct clipboard success, native TXT download, screen-reader and exhaustive concurrency checks remain pending as recorded above and in store/REVIEW.md. No Store submission, publisher account setup or paid service was performed.

## Navigation fix — 1.0.1

The action-header arrow now includes a visible «Назад» label on Export, Import, Add, edit and Remove screens. It remains outside the scrolling form. All 21 native popup checks passed in isolated Linux Chrome for Testing 154.0.8037.92, including returning from each footer action after scrolling and rejecting/accepting the dirty-form confirmation. Existing edit and import return paths use the same checked Back helper. [Export screenshot](screenshots/export-back.png).

Typecheck, lint, 20 unit tests, build/package and exact ZIP/manifest resource validation passed. Versioned packaging reads package.json and checks manifest version consistency; CI collects the generated versioned ZIP. Own MIT notice is now included alongside third-party notices.

`artifacts/cookiess-1.0.1.zip` matches the ten current dist files byte for byte. SHA256: `0ffeb183f1c816e28904d6edaef745ded1e99867a6d731177e6620deae932b5f`. The earlier 1.0.0 hash above describes the historical release. The new build does not close the previously documented Windows/macOS/Chrome 132/manual clipboard and TXT-download gaps. CI creates Actions artifacts; GitHub Releases remain separately published.
