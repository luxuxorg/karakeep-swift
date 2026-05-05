# Fix Plan: Code Review Issues

Date: 2026-05-05

## Issues

| # | Severity | File | Summary |
|---|----------|------|---------|
| 1 | Critical | background.js:199 | Message sender validation insufficient (missing origin check) |
| 2 | Critical | utils.js:24-26 | normalizeUrl returns raw input on parse failure (corrupts bookmark index) |
| 3 | Important | popup.js:179-190 | removeChipById filter bug causes focus-jump after chip removal |
| 4 | Important | background.js:20-37 | Bookmark sync can paginate unboundedly (cap at 5000) |
| 5 | Important | content.js + manifest.json | Dead content script (unused, popup uses scripting.executeScript) |
| 6 | Important | background.js:248-250 | Silent save swallows all errors (no user feedback) |

## Design

### Fix 1: Sender validation (background.js:197-201)

Add `sender.origin !== self.origin` check for defense-in-depth in MV3 service worker.

### Fix 2: normalizeUrl failure (utils.js:24-26)

Return empty string `''` on URL parse failure instead of raw input. Update test.

### Fix 3: removeChipById (popup.js:179-190)

Replace `filter` + `findIndex` with `splice` to mutate in-place, keeping idx valid for focus.

### Fix 4: Bookmark sync cap (background.js:20-37)

Add `MAX_BOOKMARK_SYNC = 5000`, break pagination when reached.

### Fix 5: Dead content.js

Delete `content.js`. Remove `content_scripts` declaration from `manifest.json`.

### Fix 6: Silent save errors (background.js:248-250)

Set red `!` badge on failure instead of swallowing errors.

## Testing

- Run `node test-utils.js` — updated normalizeUrl test must pass
- Manual: Ctrl+Shift+K with unreachable server → red `!` badge
- Manual: Tag chip keyboard removal → focus stays correct

## Affected Files

- `background.js` — Fixes 1, 4, 6
- `utils.js` — Fix 2
- `popup.js` — Fix 3
- `test-utils.js` — Fix 2 test update
- `content.js` — Delete (Fix 5)
- `manifest.json` — Remove content_scripts (Fix 5)
