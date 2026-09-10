import puppeteer from 'puppeteer';

const CITY_IDS = {
  islamabad: '3',
  lahore: '1',
  karachi: '2',
  rawalpindi: '41',
  peshawar: '17',
  faisalabad: '16',
  multan: '15',
  quetta: '40',
};

const PROPERTY_TYPE_PATHS = {
  apartment: 'Flats_Apartments',
  flat: 'Flats_Apartments',
  flats: 'Flats_Apartments',
  house: 'Houses_Property',
  houses: 'Houses_Property',
  plot: 'Plots',
  plots: 'Plots',
  commercial: 'Commercial_Properties',
};

const MAX_PAGES = 3;

let browserInstance = null;

const closeBrowser = async () => {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore close errors
    }
    browserInstance = null;
  }
};

const getBrowser = async () => {
  if (browserInstance) {
    const connected =
      browserInstance.connected !== false;

    if (connected) {
      return browserInstance;
    }

    console.log(
      '[Scraper] Browser disconnected, recreating...'
    );
    await closeBrowser();
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  return browserInstance;
};

const cleanUrl = (value) => {
  if (!value) {
    return '';
  }

  let url = String(value).trim();

  const markdownMatch = url.match(
    /^\[.*?\]\((https?:\/\/.*?)\)$/
  );

  if (markdownMatch) {
    url = markdownMatch[1];
  }

  url = url
    .replace(/^\[/, '')
    .replace(/\]$/, '');

  return url.trim();
};

const extractListingsFromPage = async (page) => {
  return await page.evaluate(() => {
    /*
     * Try the most likely Zameen listing-card selectors
     * first. We avoid selecting every nested element
     * containing the word "listing".
     */
    const selectorGroups = [
      '[data-testid="listing-card"]',
      '[data-testid="listing-card-container"]',
      'article',
    ];

    let cards = [];

    for (const selector of selectorGroups) {
      const found =
        Array.from(
          document.querySelectorAll(selector)
        );

      if (found.length > 0) {
        cards = found;
        break;
      }
    }

    /*
     * If the above selectors are unavailable,
     * find elements that contain a Zameen property URL.
     */
    if (cards.length === 0) {
      const propertyLinks =
        Array.from(
          document.querySelectorAll(
            'a[href*="/Property/"]'
          )
        );

      const possibleCards = [];

      for (const link of propertyLinks) {
        let parent = link;

        for (let i = 0; i < 6; i++) {
          if (!parent?.parentElement) {
            break;
          }

          parent = parent.parentElement;

          const text =
            parent.innerText || '';

          const hasPrice =
            /PKR/i.test(text);

          const hasArea =
            /sq\.?\s*(?:ft|yd)|sqft|kanal|marla/i.test(
              text
            );

          if (
            hasPrice &&
            hasArea &&
            text.length > 100
          ) {
            possibleCards.push(parent);
            break;
          }
        }
      }

      cards = possibleCards;
    }

    /*
     * Remove duplicate DOM elements.
     */
    cards = Array.from(
      new Set(cards)
    );

    const listings = [];

    for (const card of cards) {
      try {
        const text =
          card.innerText || '';

        if (!text.trim()) {
          continue;
        }

        /*
         * Find the actual property URL.
         */
        const links =
          Array.from(
            card.querySelectorAll(
              'a[href]'
            )
          );

        let link = '';

        for (const anchor of links) {
          const href =
            anchor.href || '';

          if (
            href.includes(
              'zameen.com/Property/'
            ) ||
            href.includes(
              'zameen.com/property/'
            )
          ) {
            link = href;
            break;
          }
        }

        if (!link) {
          continue;
        }

        /*
         * Get clean text lines.
         */
        const lines =
          text
            .split('\n')
            .map((line) =>
              line.trim()
            )
            .filter(Boolean);

        /*
         * PRICE
         *
         * Scan individual lines to find the full price
         * string including unit (e.g. "PKR 3.6 Crore",
         * "49 Lakh", "3,60,00,000"). The full-text regex
         * often misses the unit when it is on a separate
         * line from the number.
         */
        let price = '';

        const priceUnitPattern =
          /(?:PKR\s*)?([\d,.]+)\s*(Crore|Crores|Cr|Lakh|Lakhs|Million|Millions|Thousand|Thousands)?/i;

        const unitOnlyPattern =
          /\b(Crore|Crores|Cr|Lakh|Lakhs|Million|Millions|Thousand|Thousands)\b/i;

        for (let i = 0; i < lines.length; i++) {
          const priceLineMatch =
            lines[i].match(priceUnitPattern);

          if (
            priceLineMatch &&
            /PKR|Crore|Crores|Cr|Lakh|Lakhs|Million|Thousand|\d{2,}/i.test(
              lines[i]
            )
          ) {
            const numPart = priceLineMatch[1];

            if (priceLineMatch[2]) {
              price = `${numPart} ${priceLineMatch[2]}`;
            } else {
              let foundUnit = '';

              for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const unitMatch = lines[j].match(unitOnlyPattern);
                if (unitMatch) {
                  foundUnit = unitMatch[1];
                  break;
                }
              }

              price = foundUnit
                ? `${numPart} ${foundUnit}`
                : numPart;
            }

            break;
          }
        }

        /*
         * Fallback: try the full text if line scanning
         * did not find a price with a unit.
         */
        if (!price) {
          const fullTextMatch =
            text.match(
              /(?:PKR\s*)?([\d,.]+)\s*(Crore|Crores|Cr|Lakh|Lakhs|Million|Millions|Thousand|Thousands)/i
            );

          if (fullTextMatch) {
            price =
              `${fullTextMatch[1]} ${fullTextMatch[2]}`;
          }
        }

        if (price && !unitOnlyPattern.test(price)) {
          const numOnlyMatch = price.match(/([\d,.]+)/);
          if (numOnlyMatch) {
            const numStr = numOnlyMatch[1];
            const numIdx = text.indexOf(numStr);
            if (numIdx !== -1) {
              const afterNum = text.substring(numIdx, numIdx + 80);
              const lateUnitMatch = afterNum.match(unitOnlyPattern);
              if (lateUnitMatch) {
                price = `${numStr} ${lateUnitMatch[1]}`;
              }
            }
          }
        }

        /*
         * BEDROOMS
         *
         * Matches: 3 Bed, 3 Beds, 3 Bedroom, 3 Bedrooms,
         * 3 Bed Room, 3 Bed Rooms, 3 Room, 3 Rooms,
         * 3 Living Room, 3 Living Rooms, 3 Drawing Room,
         * 3 Master Bedroom, 3 Master Bedrooms
         */
        let bedrooms = 0;

        const bedroomMatch =
          text.match(
            /(\d+)\s*(?:master\s*)?(?:bed(?:\s*room)?s?|bedroom(?:\s*room)?s?|living\s*rooms?|drawing\s*rooms?|sleeping\s*rooms?|rooms?)\b/i
          );

        if (bedroomMatch) {
          bedrooms =
            Number(
              bedroomMatch[1]
            );
        }

        /*
         * BATHROOMS
         *
         * Matches: 2 Bath, 2 Baths, 2 Bathroom, 2 Bathrooms,
         * 2 Bath Room, 2 Bath Rooms, 2 Washroom, 2 Washrooms,
         * 2 Wash Room, 2 Wash Rooms, 2 Toilet, 2 Toilets,
         * 2 Ensuite, 2 Ensuites, 2 Powder Room,
         * 4+1 Bath, 4 / 2 (bed/bath format)
         */
        let bathrooms = 0;

        const bathroomPatterns = [
          /(\d+)\s*(?:\+\d+)?\s*(?:bath(?:\s*room)?s?|wash\s*rooms?|toilets?|ensuites?|powder\s*rooms?|half\s*baths?|powder\s*baths?)\b/i,
          /bath(?:room)?s?\s*[:\-\/]\s*(\d+)/i,
          /(\d+)\s*baths?\b/i,
        ];

        for (const pattern of bathroomPatterns) {
          const match = text.match(pattern);
          if (match) {
            bathrooms = Number(match[1]);
            break;
          }
        }

        /*
         * Fallback: look for bathroom info in separate
         * card elements (Zameen sometimes uses icons)
         */
        if (bathrooms === 0) {
          const bathElements =
            card.querySelectorAll(
              '[data-testid*="bath"], [class*="bath"], [aria-label*="bath"]'
            );

          for (
            const el
            of bathElements
          ) {
            const numMatch =
              el.textContent.match(
                /(\d+)/
              );

            if (numMatch) {
              bathrooms =
                Number(
                  numMatch[1]
                );

              break;
            }
          }
        }

        /*
         * AREA
         */
        let area = '';

        const areaMatch =
          text.match(
            /([\d,.]+)\s*(sq\.?\s*(?:ft|yd)|sqft|kanal|marla)/i
          );

        if (areaMatch) {
          area =
            `${areaMatch[1]} ${areaMatch[2]}`;
        }

        /*
         * IMAGE
         */
        const imageElement =
          card.querySelector(
            'img'
          );

        let image =
          imageElement?.src ||
          imageElement?.getAttribute(
            'data-src'
          ) ||
          '';

        if (
          !image &&
          imageElement?.srcset
        ) {
          image =
            imageElement.srcset
              .split(',')
              .pop()
              ?.trim()
              ?.split(' ')[0] ||
            '';
        }

        /*
         * TITLE
         *
         * Prefer headings and explicit title
         * elements.
         */
        let title = '';

        const titleSelectors = [
          'h1',
          'h2',
          'h3',
          'h4',
          '[data-testid*="title"]',
          '[class*="title"]',
        ];

        for (
          const selector
          of titleSelectors
        ) {
          const element =
            card.querySelector(
              selector
            );

          const value =
            element?.innerText?.trim();

          if (
            value &&
            value.length > 10 &&
            !/^PKR/i.test(value)
          ) {
            title = value;
            break;
          }
        }

        /*
         * If no title was found, look through
         * text lines for a likely property title.
         */
        if (!title) {
          for (
            const line
            of lines
          ) {
            if (
              line.length < 15 ||
              line.length > 250
            ) {
              continue;
            }

            if (
              /^PKR/i.test(line)
            ) {
              continue;
            }

            if (
              /^(SUPER HOT|HOT|TITANIUM)$/i.test(
                line
              )
            ) {
              continue;
            }

            if (
              /^\d+$/.test(line)
            ) {
              continue;
            }

            if (
              /^(?:bed(?:\s*room)?s?|bath(?:\s*room)?s?|wash\s*rooms?|toilets?|ensuites?|powder\s*rooms?|living\s*rooms?|drawing\s*rooms?|rooms?)$/i.test(
                line
              )
            ) {
              continue;
            }

            if (
              /sq\.?\s*(?:ft|yd)|sqft|kanal|marla/i.test(
                line
              )
            ) {
              continue;
            }

            title = line;
            break;
          }
        }

        /*
         * LOCATION
         *
         * Look for a line containing common
         * Pakistani city/area patterns.
         */
        let location = '';

        /*
         * Non-location words that should never be
         * treated as a property location.
         */
        const rejectWords = [
          'verified',
          'hot',
          'featured',
          'new',
          'titanium',
          'premium',
          'agent',
          'broker',
          'proprietor',
          'contact',
          'available',
          'rent',
          'sale',
          'sell',
          'buy',
          'invest',
          'deal',
          'token',
          'advance',
          'negotiable',
          'demand',
          'urgent',
          'offer',
        ];

        const isRejectedLocation = (value) => {
          if (!value) return true;
          const lower = value.toLowerCase().trim();
          if (lower.length < 3) return true;
          return rejectWords.includes(lower);
        };

        const locationSelectors = [
          '[data-testid*="location"]',
          '[class*="location"]',
          '[class*="area"]',
        ];

        for (
          const selector
          of locationSelectors
        ) {
          const element =
            card.querySelector(
              selector
            );

          const value =
            element?.innerText?.trim();

          if (
            value &&
            value.length > 2 &&
            !/PKR/i.test(value) &&
            !isRejectedLocation(value)
          ) {
            location =
              value;
            break;
          }
        }

        /*
         * If selector-based location fails,
         * inspect lines.
         */
        if (!location) {
          const cityNames = [
            'Islamabad',
            'Lahore',
            'Karachi',
            'Rawalpindi',
            'Peshawar',
            'Faisalabad',
            'Multan',
            'Quetta',
          ];

          for (
            const line
            of lines
          ) {
            const containsCity =
              cityNames.some(
                (city) =>
                  line
                    .toLowerCase()
                    .includes(
                      city.toLowerCase()
                    )
              );

            if (
              containsCity &&
              !/PKR/i.test(line) &&
              line !== title
            ) {
              location =
                line;
              break;
            }
          }
        }

        /*
         * Final fallback for location:
         * find a reasonable line that isn't
         * price/area/bed/bath/status text.
         */
        if (!location) {
          for (
            const line
            of lines
          ) {
            if (
              line === title ||
              line === price
            ) {
              continue;
            }

            if (
              /PKR|Crore|Lakh|Million|Thousand/i.test(
                line
              )
            ) {
              continue;
            }

            if (
              /(?:bed(?:\s*room)?s?|bath(?:\s*room)?s?|wash\s*rooms?|toilets?|ensuites?|powder\s*rooms?|living\s*rooms?|drawing\s*rooms?|rooms?)/i.test(
                line
              )
            ) {
              continue;
            }

            if (
              /sq\.?\s*(?:ft|yd)|sqft|kanal|marla/i.test(
                line
              )
            ) {
              continue;
            }

            if (
              /SUPER HOT|HOT|TITANIUM/i.test(
                line
              )
            ) {
              continue;
            }

            if (isRejectedLocation(line)) {
              continue;
            }

            if (
              line.length >= 3 &&
              line.length <= 100
            ) {
              location =
                line;
              break;
            }
          }
        }

        /*
         * Only keep listings that have a real
         * property URL.
         */
        listings.push({
          rawId: link,
          rawTitle:
            title ||
            'Property Listing',
          rawPrice:
            price ||
            'Price unavailable',
          rawLocation:
            location ||
            'Location unavailable',
          rawLink: link,
          rawImage: image,
          rawBedrooms:
            bedrooms,
          rawBathrooms:
            bathrooms,
          rawArea:
            area ||
            'N/A',
        });
      } catch (error) {
        console.error(
          '[Scraper] Error extracting listing:',
          error.message
        );
      }
    }

    return listings;
  });
};

const SCRAPE_RETRIES = 3;

export const scrapeListings = async (
  city,
  propertyType = 'house',
  criteria = {}
) => {
  const normalizedCity =
    String(city || '')
      .toLowerCase()
      .trim();

  const normalizedType =
    String(
      propertyType || 'house'
    )
      .toLowerCase()
      .trim();

  const cityId =
    CITY_IDS[
      normalizedCity
    ];

  if (!cityId) {
    console.error(
      `[Scraper] Unsupported city: ${normalizedCity}`
    );
    return [];
  }

  for (
    let attempt = 1;
    attempt <= SCRAPE_RETRIES;
    attempt++
  ) {
    let page;

    try {
      const propertyPath =
        PROPERTY_TYPE_PATHS[
          normalizedType
        ] ||
        'Houses_Property';

      const browser =
        await getBrowser();

      page =
        await browser.newPage();

      await page.setViewport({
        width: 1366,
        height: 768,
      });

      await page.setRequestInterception(
        true
      );

      page.on(
        'request',
        (request) => {
          const resourceType =
            request.resourceType();

          if (
            resourceType ===
              'image' ||
            resourceType ===
              'media' ||
            resourceType ===
              'font' ||
            resourceType ===
              'stylesheet'
          ) {
            request.abort();
          } else {
            request.continue();
          }
        }
      );

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36'
      );

      const allListings = [];

      for (
        let pageNumber = 1;
        pageNumber <= MAX_PAGES;
        pageNumber++
      ) {
        const cityName =
          normalizedCity
            .charAt(0)
            .toUpperCase() +
          normalizedCity.slice(1);

        let url =
          `https://www.zameen.com/` +
          `${propertyPath}/` +
          `${cityName}-${cityId}-${pageNumber}.html`;

        const queryParams = [];

        if (criteria.bedrooms > 0) {
          queryParams.push(
            `bedrooms_min=${criteria.bedrooms}`
          );
          queryParams.push(
            `bedrooms_max=${criteria.bedrooms}`
          );
        }

        if (
          criteria.minBudgetInCrores > 0
        ) {
          queryParams.push(
            `price_min=${Math.round(
              criteria.minBudgetInCrores *
                10000000
            )}`
          );
        }

        if (
          criteria.maxBudgetInCrores > 0
        ) {
          queryParams.push(
            `price_max=${Math.round(
              criteria.maxBudgetInCrores *
                10000000
            )}`
          );
        }

        if (queryParams.length > 0) {
          url += `?${queryParams.join(
            '&'
          )}`;
        }

        console.log(
          `[Scraper] Accessing page ${pageNumber}: ${url}`
        );

        try {
          await page.goto(
            url,
            {
              waitUntil:
                'domcontentloaded',
              timeout: 30000,
            }
          );

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                1500
              )
          );

          const listings =
            await extractListingsFromPage(
              page
            );

          console.log(
            `[Scraper] Page ${pageNumber}: extracted ${listings.length} listings`
          );

          const listingsWithTag = listings.map(
            (listing) => ({
              ...listing,
              rawCity:
                cityName,
              rawPropertyType:
                normalizedType,
            })
          );

          allListings.push(
            ...listingsWithTag
          );
        } catch (error) {
          console.error(
            `[Scraper] Page ${pageNumber} failed:`,
            error.message
          );
        }
      }

      /*
       * Clean URLs and images.
       */
      const cleanedListings =
        allListings.map(
          (listing) => {
            const cleanedLink =
              cleanUrl(
                listing.rawLink
              );

            return {
              ...listing,

              rawId:
                cleanUrl(
                  listing.rawId
                ) ||
                cleanedLink,

              rawLink:
                cleanedLink,

              rawImage:
                cleanUrl(
                  listing.rawImage
                ),
            };
          }
        );

      /*
       * Remove duplicate listings.
       */
      const uniqueListings = [];

      const seen =
        new Set();

      for (
        const listing
        of cleanedListings
      ) {
        const uniqueKey =
          listing.rawLink ||
          listing.rawId ||
          `${listing.rawTitle}-${listing.rawPrice}`;

        if (
          seen.has(uniqueKey)
        ) {
          continue;
        }

        seen.add(
          uniqueKey
        );

        uniqueListings.push(
          listing
        );
      }

      console.log(
        `[Scraper] Total unique listings: ${uniqueListings.length}`
      );

      if (
        uniqueListings.length > 0
      ) {
        console.log(
          '[Scraper] First listing:',
          JSON.stringify(
            uniqueListings[0],
            null,
            2
          )
        );
      }

      return uniqueListings;
    } catch (error) {
      const msg = String(
        error?.message || error
      ).toLowerCase();

      const isConnectionError =
        msg.includes('connection closed') ||
        msg.includes('connection reset') ||
        msg.includes('not connected') ||
        msg.includes('target closed') ||
        msg.includes('session closed') ||
        msg.includes('protocol error');

      if (
        isConnectionError &&
        attempt < SCRAPE_RETRIES
      ) {
        console.log(
          `[Scraper] Connection error on attempt ${attempt}/${SCRAPE_RETRIES}, recreating browser...`
        );
        await closeBrowser();
        await new Promise((r) =>
          setTimeout(r, 1000 * attempt)
        );
        continue;
      }

      console.error(
        '[Scraper] Fatal error:',
        error.message
      );

      return [];
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore page close errors
        }
      }
    }
  }

  return [];
};

export default scrapeListings;
