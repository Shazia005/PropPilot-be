import { GoogleGenAI } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT = 30000;
const GEMINI_RETRY_ATTEMPTS = 3;

// ---------------------------------------------------------
// Gemini setup
// ---------------------------------------------------------

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

// ---------------------------------------------------------
// Delay helper
// ---------------------------------------------------------

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------
// Extract price in Crores
// ---------------------------------------------------------

const extractPriceInCrores = (price) => {
  if (price === null || price === undefined) {
    return 0;
  }

  const text = String(price)
    .toLowerCase()
    .replace(/,/g, '')
    .trim();

  // Examples:
  // 2.5 crore
  // 5 crore
  // 2.05 cr
  const croreMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)/
  );

  if (croreMatch) {
    return Number(croreMatch[1]);
  }

  // Examples:
  // 25 lakh
  // 50 lakhs
  const lakhMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:lakh|lakhs)/
  );

  if (lakhMatch) {
    return Number(lakhMatch[1]) / 100;
  }

  // Plain number
  const numberMatch = text.match(
    /(\d+(?:\.\d+)?)/
  );

  if (numberMatch) {
    const number = Number(numberMatch[1]);

    // Large values are treated as PKR.
    if (number >= 100000) {
      return number / 10000000;
    }

    return number;
  }

  return 0;
};

// ---------------------------------------------------------
// Normalize property
// ---------------------------------------------------------

const normalizeProperty = (property) => {
  return {
    ...property,

    id:
      property.id ||
      property._id ||
      property.sourceUrl ||
      property.rawLink,

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
      'Property',

    sourceUrl:
      property.sourceUrl ||
      property.rawLink ||
      property.link ||
      '',
  };
};

// ---------------------------------------------------------
// Check temporary Gemini errors
// ---------------------------------------------------------

const isTemporaryGeminiError = (error) => {
  const status =
    error?.status ||
    error?.code ||
    error?.response?.status ||
    error?.error?.code;

  const message = String(
    error?.message ||
      error?.error?.message ||
      ''
  ).toLowerCase();

  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  if (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('temporarily')
  ) {
    return true;
  }

  return false;
};

// ---------------------------------------------------------
// Gemini intent extraction
// ---------------------------------------------------------

const extractIntentWithGemini = async (userPrompt) => {
  if (!ai) {
    throw new Error(
      'Gemini API key is not configured.'
    );
  }

  const prompt = `
You are a real estate search assistant.

Extract structured search criteria from the user's property request.

Return ONLY valid JSON.

Use exactly this structure:

{
  "city": "",
  "propertyType": "",
  "bedrooms": 0,
  "minBudgetInCrores": 0,
  "maxBudgetInCrores": 0
}

Rules:

1. city:
Return the city mentioned by the user in lowercase.

2. propertyType:
Use only:
- house
- apartment
- plot
- commercial

"flat" means apartment.

3. bedrooms:
The words bedroom, bedrooms, bed, beds, room, rooms,
and bhk can refer to the number of bedrooms.

Examples:
"3 room house" = 3 bedrooms
"4 bedroom apartment" = 4 bedrooms
"5 bhk" = 5 bedrooms

4. minBudgetInCrores:
Use this for the minimum budget.

5. maxBudgetInCrores:
Use this for the maximum budget.

Budget examples:

"under 4 crore"
=> minBudgetInCrores: 0
=> maxBudgetInCrores: 4

"below 5 crore"
=> minBudgetInCrores: 0
=> maxBudgetInCrores: 5

"2-4 crore"
=> minBudgetInCrores: 2
=> maxBudgetInCrores: 4

"2 to 4 crore"
=> minBudgetInCrores: 2
=> maxBudgetInCrores: 4

"between 2 and 4 crore"
=> minBudgetInCrores: 2
=> maxBudgetInCrores: 4

"from 2 to 4 crore"
=> minBudgetInCrores: 2
=> maxBudgetInCrores: 4

"above 3 crore"
=> minBudgetInCrores: 3
=> maxBudgetInCrores: 0

If something is not specified, use:

city = ""
propertyType = ""
bedrooms = 0
minBudgetInCrores = 0
maxBudgetInCrores = 0

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

      const timeoutPromise = new Promise(
        (_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                'Gemini request timed out.'
              )
            );
          }, GEMINI_TIMEOUT);
        }
      );

      const geminiPromise =
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
        });

      const response = await Promise.race([
        geminiPromise,
        timeoutPromise,
      ]);

      const text =
        response?.text ||
        response?.candidates?.[0]?.content?.parts?.[0]
          ?.text ||
        '';

      if (!text) {
        throw new Error(
          'Gemini returned an empty response.'
        );
      }

      console.log(
        '[AI Search] Gemini response:',
        text
      );

      const cleanedText = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(
        cleanedText
      );

      return parsed;
    } catch (error) {
      const temporary =
        isTemporaryGeminiError(error);

      console.error(
        `[AI Search] Gemini attempt ${attempt} failed:`,
        error?.message || error
      );

      // Permanent error:
      // immediately use fallback.
      if (!temporary) {
        throw error;
      }

      // Final attempt failed.
      if (
        attempt === GEMINI_RETRY_ATTEMPTS
      ) {
        console.error(
          '[AI Search] Gemini failed after all retry attempts.'
        );

        throw error;
      }

      const delay = attempt * 1000;

      console.log(
        `[AI Search] Temporary Gemini error. Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  throw new Error(
    'Gemini failed after all retry attempts.'
  );
};

// ---------------------------------------------------------
// Fallback parser
// ---------------------------------------------------------

const extractFallbackCriteria = (userPrompt) => {
  const text = String(userPrompt)
    .toLowerCase()
    .trim();

  let city = '';
  let propertyType = '';
  let bedrooms = 0;

  let minBudgetInCrores = 0;
  let maxBudgetInCrores = 0;

  // -------------------------------------------------------
  // City
  // -------------------------------------------------------

  const cities = [
    'karachi',
    'lahore',
    'islamabad',
    'rawalpindi',
    'peshawar',
    'faisalabad',
    'multan',
    'quetta',
  ];

  for (const cityName of cities) {
    if (text.includes(cityName)) {
      city = cityName;
      break;
    }
  }

  // -------------------------------------------------------
  // Property type
  // -------------------------------------------------------

  if (
    text.includes('apartment') ||
    text.includes('flat')
  ) {
    propertyType = 'apartment';
  } else if (
    text.includes('plot') ||
    text.includes('land')
  ) {
    propertyType = 'plot';
  } else if (
    text.includes('commercial') ||
    text.includes('shop') ||
    text.includes('office')
  ) {
    propertyType = 'commercial';
  } else if (
    text.includes('house') ||
    text.includes('home') ||
    text.includes('villa')
  ) {
    propertyType = 'house';
  }

  // -------------------------------------------------------
  // Bedrooms / rooms / BHK
  // -------------------------------------------------------

  const bedroomMatch = text.match(
    /(\d+)\s*(?:bedroom|bedrooms|bed|beds|bhk|room|rooms)\b/
  );

  if (bedroomMatch) {
    bedrooms = Number(
      bedroomMatch[1]
    );
  }

  // -------------------------------------------------------
  // Budget range
  // -------------------------------------------------------

  const rangeMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
  );

  if (rangeMatch) {
    minBudgetInCrores = Number(
      rangeMatch[1]
    );

    maxBudgetInCrores = Number(
      rangeMatch[2]
    );
  } else {
    // -----------------------------------------------------
    // Between 2 and 4 crore
    // -----------------------------------------------------

    const betweenMatch = text.match(
      /between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
    );

    if (betweenMatch) {
      minBudgetInCrores = Number(
        betweenMatch[1]
      );

      maxBudgetInCrores = Number(
        betweenMatch[2]
      );
    } else {
      // ---------------------------------------------------
      // From 2 to 4 crore
      // ---------------------------------------------------

      const fromToMatch = text.match(
        /from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
      );

      if (fromToMatch) {
        minBudgetInCrores = Number(
          fromToMatch[1]
        );

        maxBudgetInCrores = Number(
          fromToMatch[2]
        );
      } else {
        // -------------------------------------------------
        // Maximum budget
        // -------------------------------------------------

        const maxMatch = text.match(
          /(?:under|below|less than|max(?:imum)?|up to|upto|within|budget(?: of)?|not more than)\s*(?:rs\.?|pkr)?\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
        );

        if (maxMatch) {
          maxBudgetInCrores = Number(
            maxMatch[1]
          );
        } else {
          // -----------------------------------------------
          // Minimum budget
          // -----------------------------------------------

          const minMatch = text.match(
            /(?:above|over|more than|at least|minimum|min)\s*(?:rs\.?|pkr)?\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/
          );

          if (minMatch) {
            minBudgetInCrores = Number(
              minMatch[1]
            );
          }
        }
      }
    }
  }

  // -------------------------------------------------------
  // Fix reversed range
  // -------------------------------------------------------

  if (
    minBudgetInCrores > 0 &&
    maxBudgetInCrores > 0 &&
    minBudgetInCrores > maxBudgetInCrores
  ) {
    const temp =
      minBudgetInCrores;

    minBudgetInCrores =
      maxBudgetInCrores;

    maxBudgetInCrores = temp;
  }

  return {
    city,
    propertyType,
    bedrooms,
    minBudgetInCrores,
    maxBudgetInCrores,
  };
};

// ---------------------------------------------------------
// Normalize criteria
// ---------------------------------------------------------

const normalizeCriteria = (
  criteria = {}
) => {
  let minBudgetInCrores = Number(
    criteria.minBudgetInCrores || 0
  );

  let maxBudgetInCrores = Number(
    criteria.maxBudgetInCrores || 0
  );

  if (
    minBudgetInCrores > 0 &&
    maxBudgetInCrores > 0 &&
    minBudgetInCrores > maxBudgetInCrores
  ) {
    const temp =
      minBudgetInCrores;

    minBudgetInCrores =
      maxBudgetInCrores;

    maxBudgetInCrores = temp;
  }

  return {
    city: String(
      criteria.city || ''
    ).toLowerCase(),

    propertyType: String(
      criteria.propertyType || ''
    ).toLowerCase(),

    bedrooms: Number(
      criteria.bedrooms || 0
    ),

    minBudgetInCrores,

    maxBudgetInCrores,
  };
};

// ---------------------------------------------------------
// Main AI Search
// ---------------------------------------------------------

export const autonomousSearch = async (
  req,
  res
) => {
  const userPrompt =
    req.body?.query ||
    req.body?.prompt ||
    req.body?.search ||
    '';

  if (!userPrompt.trim()) {
    return res.status(400).json({
      success: false,
      error:
        'Search query is required.',
      properties: [],
    });
  }

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

  let criteria;
  let usedFallback = false;

  // =======================================================
  // STEP 1: GEMINI FIRST
  // =======================================================

  try {
    console.log(
      '[AI Search] Extracting search intent with Gemini...'
    );

    const geminiCriteria =
      await extractIntentWithGemini(
        userPrompt
      );

    criteria =
      normalizeCriteria(
        geminiCriteria
      );

    console.log(
      '[AI Search] Parsed Gemini criteria:',
      criteria
    );
  } catch (error) {
    // =====================================================
    // STEP 2: FALLBACK
    // =====================================================

    usedFallback = true;

    console.log(
      '[AI Search] Gemini unavailable after retries.'
    );

    console.log(
      '[AI Search] Switching to fallback search.'
    );

    console.log(
      '[AI Search] Reason:',
      error?.message || error
    );

    criteria =
      extractFallbackCriteria(
        userPrompt
      );

    console.log(
      '[AI Search] Fallback criteria:',
      criteria
    );

    console.log(
      '[AI Search] FALLBACK MODE ACTIVE'
    );
  }

  // -------------------------------------------------------
  // Validate city
  // -------------------------------------------------------

  if (!criteria.city) {
    return res.status(400).json({
      success: false,
      error:
        'Please mention a city in your search.',
      criteria,
      usedFallback,
      properties: [],
    });
  }

  // =======================================================
  // STEP 3: SCRAPE ZAMEEN
  // =======================================================

  try {
    console.log(
      '[AI Search] Searching Zameen...'
    );

    const scrapedProperties = await scrapeListings(
  criteria.city,
  criteria.propertyType
);

    console.log(
      '[AI Search] Scraper returned:',
      scrapedProperties.length
    );

    let properties =
      scrapedProperties.map(
        normalizeProperty
      );

    // =====================================================
    // BEDROOM FILTER
    // =====================================================

    if (criteria.bedrooms > 0) {
      const bedroomFiltered =
        properties.filter(
          (property) =>
            Number(
              property.bedrooms || 0
            ) >= criteria.bedrooms
        );

      console.log(
        `[AI Search] Bedroom filter (${criteria.bedrooms}+):`,
        bedroomFiltered.length
      );

      properties =
        bedroomFiltered;
    }

    // =====================================================
    // BUDGET FILTER
    // =====================================================

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

            // Keep listing if its price
            // cannot be determined.
            if (
              priceInCrores === 0
            ) {
              return true;
            }

            // Minimum budget
            if (
              criteria.minBudgetInCrores > 0 &&
              priceInCrores <
                criteria.minBudgetInCrores
            ) {
              return false;
            }

            // Maximum budget
            if (
              criteria.maxBudgetInCrores > 0 &&
              priceInCrores >
                criteria.maxBudgetInCrores
            ) {
              return false;
            }

            return true;
          }
        );

      console.log(
        '[AI Search] Budget filter:',
        {
          min:
            criteria.minBudgetInCrores,
          max:
            criteria.maxBudgetInCrores,
          results:
            budgetFiltered.length,
        }
      );

      properties =
        budgetFiltered;
    }

    // =====================================================
    // LIMIT RESULTS TO 10
    // =====================================================

    properties =
      properties.slice(0, 10);

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
      query: userPrompt,
      criteria,
      usedFallback,
      count: properties.length,
      properties,
    });
  } catch (error) {
    console.error(
      '[AI Search] Search error:',
      error
    );

    return res.status(500).json({
      success: false,
      error:
        'Unable to search properties right now.',
      details: error.message,
      criteria,
      usedFallback,
      properties: [],
    });
  }
};

// ---------------------------------------------------------
// Alias for compatibility
// ---------------------------------------------------------

export const aiSearch = autonomousSearch;

// =========================================================
// AI CHAT
// =========================================================

export const propertyChat = async (
  req,
  res
) => {
  const { message } =
    req.body || {};

  if (!message?.trim()) {
    return res.status(400).json({
      success: false,
      error:
        'Message is required.',
    });
  }

  if (!ai) {
    return res.status(503).json({
      success: false,
      error:
        'Gemini API is not configured.',
    });
  }

  try {
    const response =
      await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `
You are EstateAI, a helpful real estate assistant.

Answer the user's real estate question clearly and concisely.

If the user wants property recommendations,
tell them to use the property search feature.

User:
${message}
`,
      });

    const text =
      response?.text ||
      response?.candidates?.[0]?.content?.parts?.[0]
        ?.text ||
      '';

    return res.status(200).json({
      success: true,
      message: text,
    });
  } catch (error) {
    console.error(
      '[AI Chat] Gemini error:',
      error
    );

    return res.status(500).json({
      success: false,
      error:
        'Unable to process your message right now.',
      details: error.message,
    });
  }
};
