import { GoogleGenAI } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT = 30000;
const GEMINI_RETRY_ATTEMPTS = 3;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/*
 * Convert different price formats into Crore.
 */
const extractPriceInCrores = (price) => {
  if (
    price === null ||
    price === undefined ||
    price === ''
  ) {
    return 0;
  }

  const text = String(price)
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/pkr/g, '')
    .trim();

  const croreMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
  );

  if (croreMatch) {
    return Number(croreMatch[1]);
  }

  const lakhMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:lakh|lakhs)\b/
  );

  if (lakhMatch) {
    return Number(lakhMatch[1]) / 100;
  }

  const millionMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:million|m)\b/
  );

  if (millionMatch) {
    return Number(millionMatch[1]) / 10;
  }

  const thousandMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:thousand|k)\b/
  );

  if (thousandMatch) {
    return Number(thousandMatch[1]) / 10000;
  }

  const numberMatch = text.match(
    /(\d+(?:\.\d+)?)/
  );

  if (numberMatch) {
    const number = Number(
      numberMatch[1]
    );

    /*
     * Raw PKR value.
     *
     * Example:
     * 30000000 = 3 Crore
     */
    if (number >= 10000000) {
      return number / 10000000;
    }

    if (number >= 100000) {
      return number / 10000000;
    }

    return 0;
  }

  return 0;
};

/*
 * Normalize scraped properties into one consistent format.
 */
const normalizeProperty = (property) => {
  const sourceUrl =
    property.sourceUrl ||
    property.rawLink ||
    property.link ||
    '';

  return {
    ...property,

    id:
      property.id ||
      property._id ||
      sourceUrl,

    title:
      property.title ||
      property.rawTitle ||
      'Property Listing',

    location:
      property.location ||
      property.rawLocation ||
      'Location unavailable',

    price:
      property.price ||
      property.rawPrice ||
      'Price unavailable',

    bedrooms: Number(
      property.bedrooms ??
        property.beds ??
        property.rawBedrooms ??
        0
    ),

    bathrooms: Number(
      property.bathrooms ??
        property.baths ??
        property.rawBathrooms ??
        0
    ),

    area:
      property.area ||
      property.areaSqFt ||
      property.rawArea ||
      'N/A',

    areaSqFt:
      property.areaSqFt ||
      property.area ||
      property.rawArea ||
      'N/A',

    image:
      property.image ||
      property.imageUrl ||
      property.rawImage ||
      '',

    imageUrl:
      property.imageUrl ||
      property.image ||
      property.rawImage ||
      '',

    type:
      property.type ||
      property.propertyType ||
      property.rawPropertyType ||
      'Property',

    city:
      property.city ||
      property.rawCity ||
      '',

    sourceUrl,
  };
};

/*
 * Detect temporary Gemini errors.
 */
const isTemporaryGeminiError = (
  error
) => {
  const message =
    String(error?.message || error)
      .toLowerCase();

  return (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('resource exhausted') ||
    message.includes('temporarily')
  );
};

/*
 * Daily free-tier quota errors should NOT be retried
 * several times because waiting 30 seconds will not
 * restore a daily quota.
 */
const isDailyQuotaError = (
  error
) => {
  const message =
    String(error?.message || error)
      .toLowerCase();

  return (
    message.includes(
      'generaterequestsperdayperproject-freetier'
    ) ||
    message.includes(
      'generate_content_free_tier_requests'
    ) ||
    message.includes(
      'per day'
    )
  );
};

/*
 * Extract search intent using Gemini.
 */
const extractIntentWithGemini = async (
  userPrompt
) => {
  const prompt = `
You are a real-estate search intent parser.

Convert the user's request into ONLY valid JSON.

Allowed propertyType values:
- house
- apartment
- plot
- commercial

Return exactly this structure:

{
  "cities": [],
  "propertyType": "",
  "bedrooms": 0,
  "minBudgetInCrores": 0,
  "maxBudgetInCrores": 0
}

Rules:

1. Extract ALL cities mentioned in the request into the "cities" array.
   If the user mentions multiple cities (e.g. "rawalpindi and islamabad"),
   include ALL of them: ["rawalpindi", "islamabad"].
   If only one city is mentioned, put it in a single-element array: ["islamabad"].
   If no city is mentioned, use ["islamabad"] as default.
2. Convert "flat" or "flats" to "apartment".
3. Extract bedroom count.
4. Convert Pakistani budget expressions to Crore.
5. "under 3 crore" means maxBudgetInCrores = 3.
6. "below 5 crore" means maxBudgetInCrores = 5.
7. "between 2 and 4 crore" means min = 2 and max = 4.
8. "within 5-10 crore range" means min = 5 and max = 10.
9. "within 2 to 5 crore" means min = 2 and max = 5.
10. If no minimum budget is given, use 0.
11. If no maximum budget is given, use 0.
12. If bedrooms are not specified, use 0.
13. Do not add explanations.
14. Return JSON only.

User request:
${userPrompt}
`;

  for (
    let attempt = 1;
    attempt <= GEMINI_RETRY_ATTEMPTS;
    attempt++
  ) {
    try {
      console.log(
        `[AI Search] Gemini attempt ${attempt}/${GEMINI_RETRY_ATTEMPTS}...`
      );

      const response =
        await Promise.race([
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
          }),

          new Promise(
            (_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      'Gemini request timed out'
                    )
                  ),
                GEMINI_TIMEOUT
              )
          ),
        ]);

      const responseText =
        response?.text || '';

      console.log(
        '[AI Search] Gemini response:',
        responseText
      );

      const cleanedText =
        responseText
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

      const jsonStart =
        cleanedText.indexOf('{');

      const jsonEnd =
        cleanedText.lastIndexOf('}');

      if (
        jsonStart === -1 ||
        jsonEnd === -1
      ) {
        throw new Error(
          'Gemini returned invalid JSON'
        );
      }

      const jsonText =
        cleanedText.substring(
          jsonStart,
          jsonEnd + 1
        );

      const parsed =
        JSON.parse(jsonText);

      console.log(
        '[AI Search] Parsed Gemini criteria:',
        parsed
      );

      return parsed;
    } catch (error) {
      console.error(
        `[AI Search] Gemini attempt ${attempt} failed:`,
        error.message
      );

      /*
       * Daily quota has no benefit from retries.
       */
      if (isDailyQuotaError(error)) {
        console.log(
          '[AI Search] Gemini daily quota exceeded. Using fallback immediately.'
        );

        break;
      }

      if (
        !isTemporaryGeminiError(error) ||
        attempt === GEMINI_RETRY_ATTEMPTS
      ) {
        break;
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            1500 * attempt
          )
      );
    }
  }

  return null;
};

/*
 * Fallback parser if Gemini is unavailable.
 */
const extractFallbackCriteria = (
  userPrompt
) => {
  const text = String(
    userPrompt || ''
  ).toLowerCase();

  let propertyType =
    'house';

  if (
    text.includes('flat') ||
    text.includes('apartment')
  ) {
    propertyType = 'apartment';
  } else if (
    text.includes('plot')
  ) {
    propertyType = 'plot';
  } else if (
    text.includes('commercial') ||
    text.includes('shop') ||
    text.includes('office')
  ) {
    propertyType = 'commercial';
  }

  const cities = [
    'islamabad',
    'lahore',
    'karachi',
    'rawalpindi',
    'peshawar',
    'faisalabad',
    'multan',
    'quetta',
  ];

  const matchedCities = cities.filter(
    (item) => text.includes(item)
  );

  const citiesResult =
    matchedCities.length > 0
      ? matchedCities
      : ['islamabad'];

  let bedrooms = 0;

  const bedroomMatch =
    text.match(
      /(\d+)\s*(?:master\s*)?(?:bed(?:\s*room)?s?|bedroom(?:\s*room)?s?|living\s*rooms?|drawing\s*rooms?|sleeping\s*rooms?|rooms?)\b/i
    );

  if (bedroomMatch) {
    bedrooms = Number(
      bedroomMatch[1]
    );
  }

  let minBudgetInCrores = 0;
  let maxBudgetInCrores = 0;

  const withinRangeMatch =
    text.match(
      /within\s+(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)?\s*(?:range)?/
    );

  if (withinRangeMatch) {
    minBudgetInCrores =
      Number(withinRangeMatch[1]);
    maxBudgetInCrores =
      Number(withinRangeMatch[2]);
  } else {
    const betweenMatch =
      text.match(
        /between\s+(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)?\s*(?:and|-|to)\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)?/
      );

    if (betweenMatch) {
      minBudgetInCrores =
        Number(betweenMatch[1]);
      maxBudgetInCrores =
        Number(betweenMatch[2]);
    } else {
      const underMatch =
        text.match(
          /(?:under|below|less than|max(?:imum)?(?: budget)?(?: of)?)\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)/
        );

      if (underMatch) {
        maxBudgetInCrores =
          Number(underMatch[1]);
      }

      const overMatch =
        text.match(
          /(?:over|above|more than|minimum(?: budget)?(?: of)?)\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)/
        );

      if (overMatch) {
        minBudgetInCrores =
          Number(overMatch[1]);
      }
    }
  }

  return {
    cities: citiesResult,
    propertyType,
    bedrooms,
    minBudgetInCrores,
    maxBudgetInCrores,
  };
};

/*
 * Make sure criteria always has the expected structure.
 */
const normalizeCriteria = (
  criteria
) => {
  let cities = [];

  if (
    Array.isArray(criteria?.cities) &&
    criteria.cities.length > 0
  ) {
    cities = criteria.cities.map((c) =>
      String(c || '')
        .toLowerCase()
        .trim()
    ).filter(Boolean);
  } else if (criteria?.city) {
    cities = [
      String(criteria.city)
        .toLowerCase()
        .trim()
    ].filter(Boolean);
  }

  if (cities.length === 0) {
    cities = ['islamabad'];
  }

  return {
    cities,

    propertyType:
      String(
        criteria?.propertyType ||
          'house'
      )
        .toLowerCase()
        .trim(),

    bedrooms: Number(
      criteria?.bedrooms || 0
    ),

    minBudgetInCrores: Number(
      criteria?.minBudgetInCrores || 0
    ),

    maxBudgetInCrores: Number(
      criteria?.maxBudgetInCrores || 0
    ),
  };
};

/*
 * Main autonomous AI search.
 */
export const autonomousSearch =
  async (req, res) => {
    try {
      const userPrompt =
        String(
          req.body?.query ||
          req.body?.prompt ||
          req.body?.message ||
          ''
        ).trim();

      console.log(
        '\n========================================'
      );

      console.log(
        '[AI Search] User prompt:',
        userPrompt
      );

      console.log(
        '========================================'
      );

      if (!userPrompt) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter a property search request.',
          properties: [],
        });
      }

      /*
       * Gemini FIRST.
       */
      console.log(
        '[AI Search] Extracting search intent with Gemini...'
      );

      let criteria =
        await extractIntentWithGemini(
          userPrompt
        );

      /*
       * Fallback only if Gemini failed.
       */
      if (!criteria) {
        console.log(
          '[AI Search] Using local fallback criteria parser...'
        );

        criteria =
          extractFallbackCriteria(
            userPrompt
          );

        console.log(
          '[AI Search] Fallback criteria:',
          criteria
        );
      }

      criteria =
        normalizeCriteria(criteria);

      console.log(
        '[AI Search] Final criteria:',
        criteria
      );

      /*
       * Search Zameen for each city.
       */
      console.log(
        '[AI Search] Searching Zameen for cities:',
        criteria.cities
      );

      let scrapedProperties = [];

      for (
        const city of criteria.cities
      ) {
        console.log(
          `[AI Search] Scraping city: ${city}`
        );

        const cityResults =
          await scrapeListings(
            city,
            criteria.propertyType
          );

        console.log(
          `[AI Search] ${city}: found ${cityResults.length} listings`
        );

        scrapedProperties.push(
          ...cityResults
        );
      }

      console.log(
        '[AI Search] Total scraped:',
        scrapedProperties.length
      );

      let properties =
        scrapedProperties.map(
          normalizeProperty
        );

      /*
       * Bedroom filter.
       */
      if (criteria.bedrooms > 0) {
        const bedroomFiltered =
          properties.filter(
            (property) =>
              Number(
                property.bedrooms || 0
              ) >= criteria.bedrooms
          );

        console.log(
          `[AI Search] Bedroom filter (${criteria.bedrooms}+): ${bedroomFiltered.length}`
        );

        console.log(
          '[AI Search] Bedroom-matched listings:'
        );

        bedroomFiltered.forEach(
          (property, index) => {
            console.log(
              `[${index + 1}]`,
              {
                title:
                  property.title,
                price:
                  property.price,
                bedrooms:
                  property.bedrooms,
                location:
                  property.location,
              }
            );
          }
        );

        properties =
          bedroomFiltered;
      }

      /*
       * Keep a copy before budget filtering.
       * This allows us to explain why there are
       * no exact results.
       */
      const bedroomMatchedProperties =
        [...properties];

      /*
       * Budget filter.
       */
      if (
        criteria.minBudgetInCrores > 0 ||
        criteria.maxBudgetInCrores > 0
      ) {
        const budgetFiltered =
          properties.filter(
            (property) => {
              const priceInCrores =
                extractPriceInCrores(
                  property.price
                );

              console.log(
                '[AI Search] Price check:',
                {
                  title:
                    property.title,
                  originalPrice:
                    property.price,
                  parsedCrores:
                    priceInCrores,
                }
              );

              /*
               * If price cannot be parsed,
               * keep the listing rather than
               * incorrectly rejecting it.
               */
              if (
                priceInCrores === 0
              ) {
                return true;
              }

              if (
                criteria.minBudgetInCrores >
                  0 &&
                priceInCrores <
                  criteria.minBudgetInCrores
              ) {
                return false;
              }

              if (
                criteria.maxBudgetInCrores >
                  0 &&
                priceInCrores >
                  criteria.maxBudgetInCrores
              ) {
                return false;
              }

              return true;
            }
          );

        properties =
          budgetFiltered;

        console.log(
          '[AI Search] Budget filter:',
          {
            min:
              criteria.minBudgetInCrores,
            max:
              criteria.maxBudgetInCrores,
            results:
              properties.length,
          }
        );
      }

      /*
       * Limit results shown to frontend.
       */
      properties =
        properties.slice(0, 10);

      /*
       * Build a helpful no-results summary.
       */
      let searchSummary =
        '';

      if (properties.length === 0) {
        if (
          bedroomMatchedProperties.length === 0
        ) {
          const cityList =
            criteria.cities.join(', ');
          searchSummary =
            `No properties matching your ${criteria.bedrooms || ''} bedroom requirement were found in ${cityList}.`;
        } else {
          const prices =
            bedroomMatchedProperties
              .map((property) => ({
                price:
                  property.price,
                crores:
                  extractPriceInCrores(
                    property.price
                  ),
              }))
              .filter(
                (item) =>
                  item.crores > 0
              )
              .sort(
                (a, b) =>
                  a.crores -
                  b.crores
              );

          if (prices.length > 0) {
            const cheapest =
              prices[0];

            searchSummary =
              `No exact matches were found. The closest ${criteria.bedrooms}+ bedroom option found starts at ${cheapest.price}.`;
          } else {
            searchSummary =
              'No exact property matches were found for your search.';
          }
        }
      } else {
        const cityList =
          criteria.cities.join(', ');
        searchSummary =
          `Found ${properties.length} matching propert${
            properties.length === 1
              ? 'y'
              : 'ies'
          } in ${cityList}.`;
      }

      console.log(
        '[AI Search] Search summary:',
        searchSummary
      );

      console.log(
        '[AI Search] Returning',
        properties.length,
        'properties'
      );

      console.log(
        '========================================\n'
      );

      return res.status(200).json({
        success: true,
        criteria,
        count: properties.length,
        properties,
        searchSummary,
      });
    } catch (error) {
      console.error(
        '[AI Search] Error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to complete AI property search.',
        error: error.message,
        properties: [],
      });
    }
  };

/*
 * Keep compatibility with the existing route.
 */
export const aiSearch =
  autonomousSearch;

/*
 * Property chat endpoint.
 */
export const propertyChat =
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ''
        ).trim();

      if (!message) {
        return res.status(400).json({
          success: false,
          message:
            'Please enter a message.',
        });
      }

      const response =
        await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: `
You are an AI real-estate assistant.

Answer the user's question clearly and
helpfully.

User:
${message}
`,
        });

      return res.status(200).json({
        success: true,
        reply:
          response?.text ||
          'I could not generate a response.',
      });
    } catch (error) {
      console.error(
        '[Property Chat] Error:',
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to process your message.',
        error: error.message,
      });
    }
  };