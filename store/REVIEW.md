# Review instructions and manual release gate

Use a separate browser profile and artificial cookies. No login or external service is required. Do not include real session cookies in reports or screenshots.

## Reproducible test site

Create an empty directory and run `python -m http.server 8765 --bind 127.0.0.1` there (on Windows, `py -m http.server 8765 --bind 127.0.0.1` also works). Open `http://127.0.0.1:8765/`. This local site is sufficient for the basic review; HTTPS/parent-domain/partition fixtures require the project's isolated browser suite.

1. Load the unpacked release ZIP in a separate Chrome profile; pin Cookiess.
2. Open the test site, invoke Cookiess and decline the optional access request. Confirm the denial is distinct from an empty list. Request access again and approve.
3. Add `cookiess-demo` with value `synthetic-only`, path `/`, host-only, session and Secure off. Save; verify actual returned attributes.
4. Edit the value; Cancel an unsaved edit and check confirmation. Save an edit and verify reread state. Switch light/dark/system themes.
5. Export JSON using Download and Copy; confirm downloaded file contents and pasted clipboard text. Export unpartitioned records as TXT and verify the downloaded file. No real cookies should be used.
6. Import that JSON with preview, first Skip, then Replace. Try malformed JSON and a foreign-domain cookie; confirm visible invalid/skipped results without site clearing.
7. Add same-name records on `/` and `/account`. Deleting `/account` while `/` exists must be refused as ambiguous. Delete `/` first, then `/account`. Check selected-only removal; Remove with no selection must not silently delete all. Test explicit delete-all confirmation.
8. Navigate to another origin; attempt a write from an old popup context. It must be blocked until refresh. Revoke site permission; verify blocked access.
9. Enable incognito access only in the synthetic profile. In a native incognito window open the test site and add a different synthetic cookie. Confirm normal and private stores stay separate.
10. Traverse search, selection, editor, import/export and confirmations with Tab/Shift+Tab/Enter/Escape where supported. Review announcements and labels with a screen reader. External dismissal of Chrome's popup discards drafts by design.

## Evidence matrix

| Check | Status |
| --- | --- |
| Linux Chromium 154 native action popup, synthetic data | 20 checks passed; see VERIFICATION.md |
| Linux Chrome for Testing 154 | 20 native-popup checks passed, 154.0.8037.92; see VERIFICATION.md |
| Windows stable Chrome native popup, clipboard and TXT download | Pending manual execution |
| macOS stable Chrome native popup | Pending manual execution |
| Minimum Chrome 132 | Pending manual execution |
| Windows/macOS/Linux CI typecheck, lint, unit tests, ZIP build | Separate automated checks; not browser acceptance |
| Screen reader audit | Pending manual execution |
| Concurrent site-mutation stress | Not exhaustively verified; operations are non-atomic |

For each manual run record OS/browser version, build/commit, observed result and synthetic evidence. Do not change Pending to Passed without executing the check.

## Submission

Confirm all prepared texts and privacy declarations against the release. Enter the verified policy URL, select the final category, upload the prepared images and ZIP, and save a draft. Actual submission/publication or paid account setup needs separate authorization.
