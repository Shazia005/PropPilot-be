import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

export async function scrapeListings(city = 'Lahore', propertyType = 'House') {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const formattedCity = city.toLowerCase().replace(/\s+/g, '-');
    const targetUrl = `https://www.zameen.com/Houses_Property/${formattedCity}-3-1.html`;

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const content = await page.content();
    const $ = cheerio.load(content);

    const rawListings = [];
    $('li[role="article"]').each((index, element) => {
      if (index < 6) {
        rawListings.push({
          rawTitle: $(element).find('h2').text().trim(),
          rawPrice: $(element).find('[aria-label="Price"]').text().trim(),
          rawLocation: $(element).find('[aria-label="Location"]').text().trim(),
        });
      }
    });

    await browser.close();
    return rawListings;
  } catch (error) {
    if (browser) await browser.close();
    console.error('Scraper Error:', error.message);
    return [];
  }
}