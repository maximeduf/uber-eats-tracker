# Uber Eats Expense Tracker

TypeScript monorepo with:

- Express API + SQLite database
- Playwright scraper for Uber Eats historical orders
- Vue app to visualize raw JSON order data

## Project structure

- `apps/api` - Node.js Express API and SQLite access
- `apps/scraper` - Playwright scraper that reads orders and POSTs them to the API
- `apps/web` - Vue app that displays orders as raw JSON
- `data/` - SQLite database file location (`ubereats.db`)

## Copilot guidance

- See `.github/copilot-instructions.md` for project-specific coding and scraper reliability guidance used by GitHub Copilot.

## Prerequisites

- Node.js 20+
- Google Chrome installed locally

## Setup

```bash
npm install
npx playwright install chrome
```

## Run API

```bash
npm run dev:api
```

API base URL: `http://localhost:3000`

## Run Web app

```bash
npm run dev:web
```

Web URL: `http://localhost:5173`

The web app fetches from `/api/orders` and proxies to the API.

## Run scraper

With API running:

```bash
npm run scrape
```

### Open the same Playwright Chrome profile manually

```bash
npm run chrome:playwright-profile
```

Recommended flow when login is blocked during automation:

1. Run `npm run chrome:playwright-profile`.
2. Log in to Uber Eats manually.
3. Close that browser window.
4. Run `npm run scrape`.

### Use Windows Chrome from WSL via CDP (recommended for Google login)

1. Start Chrome on Windows with remote debugging enabled:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\ue-cdp"
```

2. In WSL, run the scraper and attach to that browser:

```bash
CDP_URL=http://127.0.0.1:9222 npm run scrape
```

Notes:

- Keep that Windows Chrome instance open while scraping.
- This mode avoids the "browser might not be secure" issue common with automated Chromium sessions.
- If Uber Eats is already open in that Chrome window, the scraper reuses an existing tab or opens one.

What the scraper does:

1. Opens `https://myprivacy.uber.com/exploreyourdata/orders` directly in Chrome via Playwright.
2. Waits for the orders table to become available.
3. Expands full history by repeatedly scrolling to the bottom until row count stops growing.
4. Waits an additional 10 seconds to allow any delayed row rendering to finish.
5. Extracts each order row from `table tbody tr`:
  - first `td`: full datetime text (for example `Feb 22, 2026, 10:09:13 AM`)
  - second `td > span > span`: restaurant name
  - fifth `td`: total price (CAD, with `$`)
7. Sends all parsed orders to `POST /orders/bulk`.

## API endpoints

- `GET /health`
- `GET /orders`
- `POST /orders/bulk`

`POST /orders/bulk` body:

```json
{
  "orders": [
    {
      "restaurantName": "Example",
      "totalPrice": 24.99,
      "orderedAtText": "Feb 22, 2026, 10:09:13 AM",
      "sourceSignature": "Example__Feb 22, 2026, 10:09:13 AM__24.99"
    }
  ]
}
```

Duplicates are skipped using a unique `sourceSignature`.

## Environment variables

- API:
  - `PORT` (default `3000`)
  - `DB_PATH` (default `data/ubereats.db`)
- Scraper:
  - `API_BASE_URL` (default `http://localhost:3000`)
  - `PLAYWRIGHT_USER_DATA_DIR` (default `apps/scraper/.pw-user-data`)
  - `CDP_URL` (example `http://127.0.0.1:9222`; when set, scraper attaches to an existing browser)
