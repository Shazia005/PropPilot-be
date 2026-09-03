import puppeteer from 'puppeteer';

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
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
    });

    const page = await browser.newPage();

    // Abort heavy media, but keep stylesheets for dynamic layout rendering
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'font'].includes(req.resourceType())) {
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

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 25000 });

    const rawListings = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li[role="article"], article, div[aria-label="Listing"]'));

      return items.slice(0, 10).map((el, idx) => {
        const titleEl = el.querySelector('h2, [aria-label="Title"], a[title]');
        const priceEl = el.querySelector('[aria-label="Price"], span[title*="PKR"], span[class*="f343d9ac"]');
        const locationEl = el.querySelector('[aria-label="Location"], div[aria-label="Listing location"]');
        const linkEl = el.querySelector('a');

        return {
          rawId: `zam-${idx + 1}`,
          rawTitle: titleEl ? titleEl.textContent.trim() : '',
          rawPrice: priceEl ? priceEl.textContent.trim() : '',
          rawLocation: locationEl ? locationEl.textContent.trim() : '',
          rawLink: linkEl ? linkEl.href : ''
        };
      }).filter(item => item.rawTitle || item.rawPrice);
    });

    await browser.close();
    return rawListings;

  } catch (error) {
    if (browser) await browser.close();
    console.error('Scraper Error:', error.message);
    return [];
  }
}