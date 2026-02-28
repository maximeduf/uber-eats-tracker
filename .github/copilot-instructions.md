# Copilot Instructions for `uber-eats-tracker`

## Project context

This repository is a local personal tracker for Uber Eats expenses.

Tech stack:
- Monorepo with npm workspaces
- TypeScript everywhere
- `apps/api`: Node.js + Express + SQLite
- `apps/scraper`: Playwright scraper
- `apps/web`: Vue app that shows metrics + raw JSON from API

Primary workflow:
1. Run scraper to collect historical orders from Uber Eats.
2. Scraper posts parsed data to API.
3. API stores records in local SQLite.
4. Web app reads and shows stored data.

## High-priority coding rules

- Keep changes minimal and scoped.
- Preserve working scraper behavior unless explicitly asked to refactor.
- Prefer reliability over elegance for UI scraping.
- Avoid introducing unrelated features.

## Scraper-specific guidance (critical)

### Navigation and page assumptions
- Start from: `https://myprivacy.uber.com/exploreyourdata/orders`
- Do not depend on homepage navigation if direct URL works.
- Data is extracted from a table (`table tbody tr`).
- Each row is an order candidate with stable column positions.

### Extraction pattern (current approach)
For each table row:
- first `td`: datetime text (example `Feb 22, 2026, 10:09:13 AM`)
- second `td > span > span`: restaurant name
- fifth `td`: total price with `$`

### Expansion behavior
- Expand full history by scrolling to the bottom until row count no longer grows.
- Do not stop after one no-growth pass; repeat no-growth detection for a few passes.
- Keep a safety iteration cap.
- After expansion appears complete, wait 10 seconds before extraction to allow delayed row rendering.

### IMPORTANT runtime pitfall
In this environment, `page.evaluate` / `locator.evaluateAll` has produced runtime errors like:
- `ReferenceError: __name is not defined`

Prefer Playwright locator APIs (`count`, `allTextContents`, `textContent`, `isVisible`, etc.) and page input actions (`keyboard`, `mouse`) over injected evaluate functions whenever possible.

## Data model expectations

API order payload fields used by scraper:
- `restaurantName`
- `totalPrice`
- `orderedAtText`
- `sourceSignature`

`sourceSignature` should remain deterministic for dedupe.

Legacy note:
- The SQLite `orders` table still retains older columns (`item_count`, `ordered_date`, `ordered_time`) for compatibility with existing local data.
- Treat these as internal storage compatibility fields; scraper/API contracts should continue using the compact payload fields above.

## Logging and debug behavior

- Keep debug logs behind env toggle (`DEBUG_SCRAPER`).
- Keep logs actionable (candidate detection, click path, extraction values, skip reasons).
- Avoid noisy logs in normal mode.

## Web/API guidance

- API should stay simple and local-first.
- Web app should remain minimal unless requested (raw JSON view is acceptable baseline).
- Security hardening is not a current priority for this personal local workflow.
