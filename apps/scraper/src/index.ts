import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { buildScrapedOrder, normalizeText, parsePriceFromText, type ScrapedOrder } from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR ?? path.resolve(__dirname, '../.pw-user-data');
const cdpUrl = process.env.CDP_URL;
const debugScraper = (process.env.DEBUG_SCRAPER ?? '1') !== '0';

const pageUrl = 'https://myprivacy.uber.com/exploreyourdata/orders';
const rowSelector = 'table tbody tr';

function debugLog(message: string, details?: unknown): void {
  if (!debugScraper) {
    return;
  }

  if (details !== undefined) {
    console.log(`[scraper:debug] ${message}`, details);
    return;
  }

  console.log(`[scraper:debug] ${message}`);
}

async function run(): Promise<void> {
  const { browserContext, page, shouldCloseContext } = await createContextAndPage();

  try {
    console.log(`Using API: ${apiBaseUrl}`);
    if (cdpUrl) {
      console.log(`Connected over CDP: ${cdpUrl}`);
    }

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await waitForOrdersTableReady(page);
    await expandOrdersTable(page);

    const orders = await extractOrdersFromTable(page);

    if (orders.length === 0) {
      console.log('No orders detected in privacy table; nothing to scrape.');
      return;
    }

    console.log(`Scraped ${orders.length} order(s). Posting to API...`);

    const response = await fetch(`${apiBaseUrl}/orders/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API request failed (${response.status}): ${body}`);
    }

    const result = await response.json();
    console.log('Import completed:', result);
  } finally {
    if (shouldCloseContext) {
      await browserContext.close();
    }
  }
}

async function createContextAndPage(): Promise<{ browserContext: BrowserContext; page: Page; shouldCloseContext: boolean }> {
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      browserContext: context,
      page,
      shouldCloseContext: false
    };
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 }
  });

  const page = context.pages()[0] ?? (await context.newPage());

  return {
    browserContext: context,
    page,
    shouldCloseContext: true
  };
}

async function waitForOrdersTableReady(page: Page): Promise<void> {
  await page.waitForSelector('table', { timeout: 90_000 });
  await page.waitForSelector(rowSelector, { timeout: 90_000 });
}

async function expandOrdersTable(page: Page): Promise<void> {
  let previousCount = await page.locator(rowSelector).count();
  let stablePasses = 0;

  for (let iteration = 1; iteration <= 240; iteration += 1) {
    await nudgeToBottom(page);
    await page.waitForTimeout(1_500);

    const nextCount = await page.locator(rowSelector).count();
    debugLog(`expand: iteration=${iteration}, rows(before=${previousCount}, after=${nextCount})`);

    if (nextCount > previousCount) {
      previousCount = nextCount;
      stablePasses = 0;
      continue;
    }

    stablePasses += 1;
    if (stablePasses >= 3) {
      break;
    }
  }

  debugLog('expand: waiting 10s settle before extraction');
  await page.waitForTimeout(10_000);
}

async function extractOrdersFromTable(page: Page): Promise<ScrapedOrder[]> {
  const rows = page.locator(rowSelector);
  const rowCount = await rows.count();
  const orders: ScrapedOrder[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator('td');
    const cellCount = await cells.count();
    if (cellCount < 5) {
      continue;
    }

    const orderedAtText = normalizeText((await cells.nth(0).textContent()) ?? '');

    const restaurantSpan = cells.nth(1).locator('span > span').first();
    const restaurantName =
      normalizeText((await restaurantSpan.textContent()) ?? '') || normalizeText((await cells.nth(1).textContent()) ?? '');

    const rawPriceText = normalizeText((await cells.nth(4).textContent()) ?? '');
    const totalPrice = parsePriceFromText(rawPriceText);

    if (!orderedAtText || !restaurantName || totalPrice === null) {
      debugLog(`extract: skipped row ${index + 1}`, {
        orderedAtText,
        restaurantName,
        rawPriceText
      });
      continue;
    }

    orders.push(
      buildScrapedOrder({
        restaurantName,
        totalPrice,
        orderedAtText
      })
    );
  }

  debugLog('extract: summary', { rowCount, parsedOrders: orders.length });
  return orders;
}

async function nudgeToBottom(page: Page): Promise<void> {
  await page.keyboard.press('End').catch(() => {
    // best-effort
  });

  await page.mouse.wheel(0, 6000).catch(() => {
    // best-effort
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
