import puppeteer from 'puppeteer';

// Browser singleton instance
let browserInstance = null;

// Concurrency rate limiting
let activeScrapers = 0;
const MAX_CONCURRENT_SCRAPERS = 2;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        // REMOVED: '--single-process' - causes memory leaks under load
      ],
    });
  }
  return browserInstance;
}

const formatCity = (city) => {
  if (!city) return 'Lahore';
  return city
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
};

const formatPropertyType = (type = '') => {
  const lower = type.toLowerCase();
  if (lower.includes('flat') || lower.includes('apartment')) return 'Flats_Apartments';
  if (lower.includes('plot') || lower.includes('land')) return 'Plots';
  if (lower.includes('commercial') || lower.includes('shop') || lower.includes('office')) return 'Commercial';
  return 'Houses_Property';
};

export async function scrapeListings(city = 'Lahore', propertyType = 'House') {
  // Queue requests if max concurrency is reached
  while (activeScrapers >= MAX_CONCURRENT_SCRAPERS) {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  activeScrapers++;
  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'font', 'stylesheet', 'other'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    const formattedCity = formatCity(city);
    const formattedType = formatPropertyType(propertyType);
    const targetUrl = `https://www.zameen.com/${formattedType}/${formattedCity}-3-1.html`;

    console.log(`[Scraper] Accessing: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for listing articles safely
    await page.waitForSelector('li[role="article"], article, div[aria-label="Listing"]', { timeout: 4000 }).catch(() => null);

    const rawListings = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li[role="article"], article, div[aria-label="Listing"]'));

      return items.slice(0, 10).map((el, idx) => {
        try {
          const titleEl = el.querySelector('h2, [aria-label="Title"], a[title]');
          const priceEl = el.querySelector('[aria-label="Price"], span[title*="PKR"], span[class*="f343d9ac"]');
          const locationEl = el.querySelector('[aria-label="Location"], div[aria-label="Listing location"]');
          const linkEl = el.querySelector('a');

          const title = titleEl ? titleEl.textContent.trim() : '';
          const price = priceEl ? priceEl.textContent.trim() : '';
          const location = locationEl ? locationEl.textContent.trim() : '';
          const link = linkEl ? linkEl.href : '';

          return {
            rawId: link ? link.split('/').pop().replace('.html', '') : `zam-${idx + 1}`,
            rawTitle: title,
            rawPrice: price,
            rawLocation: location,
            rawLink: link
          };
        } catch (e) {
          return null;
        }
      }).filter((item) => item && (item.rawTitle || item.rawPrice));
    });

    await page.close();
    return rawListings || [];

  } catch (error) {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    console.error('[Scraper Error]:', error.message);
    return [];
  } finally {
    activeScrapers--;
  }
}
