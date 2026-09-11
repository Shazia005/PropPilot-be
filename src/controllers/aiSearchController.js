import { GoogleGenAI } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT = 30000;
const GEMINI_RETRY_ATTEMPTS = 3;
const MAX_RESULTS = 20;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/*
 * Convert price string into Crore value.
 * e.g. "3.6 Crore" -> 3.6, "49 Lakh" -> 0.49, "36500000" -> 3.65
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

  const numberMatch = text.match(
    /(\d+(?:\.\d+)?)/
  );

  if (!numberMatch) {
    return 0;
  }

  const number = Number(
    numberMatch[1]
  );

  if (
    text.includes('crore') ||
    text.includes('cr')
  ) {
    return number;
  }

  if (
    text.includes('lakh') ||
    text.includes('lac')
  ) {
    return number / 100;
  }

  if (number >= 100000) {
    return number / 10000000;
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

  const bedrooms = Number(
    property.bedrooms ??
      property.beds ??
      property.rawBedrooms ??
      0
  );

  let bathrooms = Number(
    property.bathrooms ??
      property.baths ??
      property.rawBathrooms ??
      0
  );

  if (bathrooms === 0) {
    bathrooms = null;
  }

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

    bedrooms,

    bathrooms,

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
 * Detect timeout errors (should be retried).
 */
const isTimeoutError = (
  error
) => {
  const message =
    String(error?.message || error)
      .toLowerCase();

  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('etimedout')
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
  "bedroomFilterType": "exact",
  "bedrooms": 0,
  "bedroomMin": 0,
  "bedroomMax": 0,
  "bedroomOptions": [],
  "bathroomFilterType": "exact",
  "bathrooms": 0,
  "bathroomMin": 0,
  "bathroomMax": 0,
  "bathroomOptions": [],
  "minBudgetInCrores": 0,
  "maxBudgetInCrores": 0
}

Rules:

1. Extract ALL cities mentioned into "cities" array. Include ALL of them.
   If only one city, single-element array. If no city, use ["islamabad"].
2. "flat"/"flats" -> "apartment".
3. Negative phrasing about property type -> set desired type.
4. Extract bedroom count from keywords: "bedroom", "beds", "bed", "rooms".
5. Extract bathroom count from keywords: "bath", "baths", "bathroom", "bathrooms", "washroom", "washrooms", "toilet", "toilets", "ensuite", "ensuites", "half bath", "powder room".
6. Convert Pakistani budget expressions to Crore.

Bedroom filter rules:
- "2 rooms", "2 bedrooms", "exactly 2 bedrooms", "2 bed" -> bedroomFilterType: "exact", bedrooms: 2
- "2+ bedrooms", "at least 2 bedrooms", "2 or more bedrooms" -> bedroomFilterType: "minimum", bedrooms: 2
- "3 or 4 bedrooms", "3/4 bedrooms" -> bedroomFilterType: "or", bedroomOptions: [3, 4]
- "between 3 and 5 bedrooms", "3 to 5 bedrooms" -> bedroomFilterType: "range", bedroomMin: 3, bedroomMax: 5
- If no bedrooms mentioned -> bedroomFilterType: "exact", bedrooms: 0

Bathroom filter rules:
- "2 baths", "2 bathrooms", "exactly 2 bathrooms" -> bathroomFilterType: "exact", bathrooms: 2
- "2+ baths", "at least 2 bathrooms" -> bathroomFilterType: "minimum", bathrooms: 2
- "between 2 and 3 baths" -> bathroomFilterType: "range", bathroomMin: 2, bathroomMax: 3
- If no bathrooms mentioned -> bathroomFilterType: "exact", bathrooms: 0

Budget rules:
- "under 3 crore" -> maxBudgetInCrores: 3
- "below 5 crore" -> maxBudgetInCrores: 5
- "between 2 and 4 crore" -> min: 2, max: 4
- "within 5-10 crore range" -> min: 5, max: 10
- "within 2 to 5 crore" -> min: 2, max: 5
- If no minimum budget, use 0.
- If no maximum budget, use 0.

Do not add explanations. Return JSON only.

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
        !isTemporaryGeminiError(error) &&
        !isTimeoutError(error) ||
        attempt === GEMINI_RETRY_ATTEMPTS
      ) {
        break;
      }

      console.log(
        `[AI Search] Retrying in ${1500 * attempt}ms...`
      );

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

  const negativePatterns =
    /\b(?:no|not|don'?t|dont|without|exclude|excluding|skip|except|apart\s*from|other\s*than)\b/i;

  const isNegated = (word) => {
    const idx = text.indexOf(word);
    if (idx === -1) return false;
    const before = text.substring(
      Math.max(0, idx - 30),
      idx
    );
    return negativePatterns.test(before);
  };

  if (
    (text.includes('flat') ||
      text.includes('apartment')) &&
    !isNegated('flat') &&
    !isNegated('apartment')
  ) {
    propertyType = 'apartment';
  } else if (
    text.includes('plot') &&
    !isNegated('plot')
  ) {
    propertyType = 'plot';
  } else if (
    (text.includes('commercial') ||
      text.includes('shop') ||
      text.includes('office')) &&
    !isNegated('commercial') &&
    !isNegated('shop') &&
    !isNegated('office')
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

  /*
   * Bedroom detection with filter types.
   */
  let bedroomFilterType = 'exact';
  let bedrooms = 0;
  let bedroomMin = 0;
  let bedroomMax = 0;
  let bedroomOptions = [];

  const bedroomKeywords =
    /(?:master\s*)?(?:bed(?:\s*room)?s?|bedroom(?:\s*room)?s?|living\s*rooms?|drawing\s*rooms?|sleeping\s*rooms?|rooms?)\b/i;

  const orBedroomMatch = text.match(
    new RegExp(
      `(\\d+)\\s*or\\s*(\\d+)\\s*${bedroomKeywords.source}`,
      'i'
    )
  );

  if (orBedroomMatch) {
    bedroomFilterType = 'or';
    bedroomOptions = [
      Number(orBedroomMatch[1]),
      Number(orBedroomMatch[2])
    ];
  } else {
    const rangeBedroomMatch = text.match(
      new RegExp(
        `(?:between|from)\\s+(\\d+)\\s*(?:and|-|to)\\s*(\\d+)\\s*${bedroomKeywords.source}`,
        'i'
      )
    );

    if (rangeBedroomMatch) {
      bedroomFilterType = 'range';
      bedroomMin = Number(
        rangeBedroomMatch[1]
      );
      bedroomMax = Number(
        rangeBedroomMatch[2]
      );
    } else {
      const minBedroomMatch =
        text.match(
          new RegExp(
            `(\\d+)\\s*\\+\\s*${bedroomKeywords.source}`,
            'i'
          )
        ) ||
        text.match(
          new RegExp(
            `at\\s*least\\s+(\\d+)\\s*${bedroomKeywords.source}`,
            'i'
          )
        );

      if (minBedroomMatch) {
        bedroomFilterType = 'minimum';
        bedrooms = Number(
          minBedroomMatch[1]
        );
      } else {
        const exactBedroomMatch =
          text.match(
            new RegExp(
              `(\\d+)\\s*${bedroomKeywords.source}`,
              'i'
            )
          );

        if (exactBedroomMatch) {
          bedroomFilterType = 'exact';
          bedrooms = Number(
            exactBedroomMatch[1]
          );
        }
      }
    }
  }

  /*
   * Bathroom detection with filter types.
   */
  let bathroomFilterType = 'exact';
  let bathrooms = 0;
  let bathroomMin = 0;
  let bathroomMax = 0;
  let bathroomOptions = [];

  const bathroomKeywords =
    /(?:bath(?:\s*room)?s?|wash\s*rooms?|toilets?|ensuites?|powder\s*rooms?|half\s*baths?|powder\s*baths?)\b/i;

  const orBathMatch = text.match(
    new RegExp(
      `(\\d+)\\s*or\\s*(\\d+)\\s*${bathroomKeywords.source}`,
      'i'
    )
  );

  if (orBathMatch) {
    bathroomFilterType = 'or';
    bathroomOptions = [
      Number(orBathMatch[1]),
      Number(orBathMatch[2])
    ];
  } else {
    const rangeBathMatch = text.match(
      new RegExp(
        `(?:between|from)\\s+(\\d+)\\s*(?:and|-|to)\\s*(\\d+)\\s*${bathroomKeywords.source}`,
        'i'
      )
    );

    if (rangeBathMatch) {
      bathroomFilterType = 'range';
      bathroomMin = Number(
        rangeBathMatch[1]
      );
      bathroomMax = Number(
        rangeBathMatch[2]
      );
    } else {
      const minBathMatch =
        text.match(
          new RegExp(
            `(\\d+)\\s*\\+\\s*${bathroomKeywords.source}`,
            'i'
          )
        ) ||
        text.match(
          new RegExp(
            `at\\s*least\\s+(\\d+)\\s*${bathroomKeywords.source}`,
            'i'
          )
        );

      if (minBathMatch) {
        bathroomFilterType = 'minimum';
        bathrooms = Number(
          minBathMatch[1]
        );
      } else {
        const exactBathMatch =
          text.match(
            new RegExp(
              `(\\d+)\\s*${bathroomKeywords.source}`,
              'i'
            )
          );

        if (exactBathMatch) {
          bathroomFilterType = 'exact';
          bathrooms = Number(
            exactBathMatch[1]
          );
        }
      }
    }
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
    bedroomFilterType,
    bedrooms,
    bedroomMin,
    bedroomMax,
    bedroomOptions,
    bathroomFilterType,
    bathrooms,
    bathroomMin,
    bathroomMax,
    bathroomOptions,
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

  let bedroomFilterType =
    String(
      criteria?.bedroomFilterType || 'exact'
    )
      .toLowerCase()
      .trim();

  let bedrooms = Number(
    criteria?.bedrooms || 0
  );

  let bedroomMin = Number(
    criteria?.bedroomMin || 0
  );

  let bedroomMax = Number(
    criteria?.bedroomMax || 0
  );

  let bedroomOptions =
    Array.isArray(
      criteria?.bedroomOptions
    )
      ? criteria.bedroomOptions
          .map(Number)
          .filter(
            (n) => n > 0
          )
      : [];

  if (
    ![
      'exact',
      'minimum',
      'or',
      'range'
    ].includes(bedroomFilterType)
  ) {
    bedroomFilterType = 'exact';
  }

  let bathroomFilterType =
    String(
      criteria?.bathroomFilterType || 'exact'
    )
      .toLowerCase()
      .trim();

  let bathrooms = Number(
    criteria?.bathrooms || 0
  );

  let bathroomMin = Number(
    criteria?.bathroomMin || 0
  );

  let bathroomMax = Number(
    criteria?.bathroomMax || 0
  );

  let bathroomOptions =
    Array.isArray(
      criteria?.bathroomOptions
    )
      ? criteria.bathroomOptions
          .map(Number)
          .filter(
            (n) => n > 0
          )
      : [];

  if (
    ![
      'exact',
      'minimum',
      'or',
      'range'
    ].includes(bathroomFilterType)
  ) {
    bathroomFilterType = 'exact';
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

    bedroomFilterType,
    bedrooms,
    bedroomMin,
    bedroomMax,
    bedroomOptions,

    bathroomFilterType,
    bathrooms,
    bathroomMin,
    bathroomMax,
    bathroomOptions,

    minBudgetInCrores: Number(
      criteria?.minBudgetInCrores || 0
    ),

    maxBudgetInCrores: Number(
      criteria?.maxBudgetInCrores || 0
    ),
  };
};

/*
 * Check if a bedroom value matches the criteria.
 */
const matchesBedroomFilter = (
  propertyBedrooms,
  criteria
) => {
  const beds = Number(
    propertyBedrooms || 0
  );

  switch (
    criteria.bedroomFilterType
  ) {
    case 'exact':
      return beds === criteria.bedrooms;

    case 'minimum':
      return beds >= criteria.bedrooms;

    case 'or':
      return criteria.bedroomOptions.includes(
        beds
      );

    case 'range':
      return (
        beds >= criteria.bedroomMin &&
        beds <= criteria.bedroomMax
      );

    default:
      return beds === criteria.bedrooms;
  }
};

/*
 * Check if a bathroom value matches the criteria.
 * Returns false for null/unknown when a requirement exists.
 */
const matchesBathroomFilter = (
  propertyBathrooms,
  criteria
) => {
  if (
    propertyBathrooms === null ||
    propertyBathrooms === undefined
  ) {
    return false;
  }

  const baths = Number(
    propertyBathrooms
  );

  switch (
    criteria.bathroomFilterType
  ) {
    case 'exact':
      return baths === criteria.bathrooms;

    case 'minimum':
      return baths >= criteria.bathrooms;

    case 'or':
      return criteria.bathroomOptions.includes(
        baths
      );

    case 'range':
      return (
        baths >= criteria.bathroomMin &&
        baths <= criteria.bathroomMax
      );

    default:
      return baths === criteria.bathrooms;
  }
};

/*
 * Get a human-readable bedroom requirement text.
 */
const getBedroomText = (criteria) => {
  switch (
    criteria.bedroomFilterType
  ) {
    case 'exact':
      return criteria.bedrooms > 0
        ? `${criteria.bedrooms} bedroom`
        : null;

    case 'minimum':
      return criteria.bedrooms > 0
        ? `${criteria.bedrooms}+ bedroom`
        : null;

    case 'or':
      return criteria.bedroomOptions.length >
        0
        ? `${criteria.bedroomOptions.join(
            ' or '
          )} bedroom`
        : null;

    case 'range':
      return criteria.bedroomMin > 0 &&
        criteria.bedroomMax > 0
        ? `${criteria.bedroomMin}-${criteria.bedroomMax} bedroom`
        : null;

    default:
      return null;
  }
};

/*
 * Get a human-readable bathroom requirement text.
 */
const getBathroomText = (criteria) => {
  switch (
    criteria.bathroomFilterType
  ) {
    case 'exact':
      return criteria.bathrooms > 0
        ? `${criteria.bathrooms} bathroom`
        : null;

    case 'minimum':
      return criteria.bathrooms > 0
        ? `${criteria.bathrooms}+ bathroom`
        : null;

    case 'or':
      return criteria.bathroomOptions
        .length > 0
        ? `${criteria.bathroomOptions.join(
            ' or '
          )} bathroom`
        : null;

    case 'range':
      return criteria.bathroomMin > 0 &&
        criteria.bathroomMax > 0
        ? `${criteria.bathroomMin}-${criteria.bathroomMax} bathroom`
        : null;

    default:
      return null;
  }
};

/*
 * Distribute properties fairly across requested cities
 * using round-robin selection.
 */
const distributeFairly = (
  properties,
  cities,
  limit
) => {
  if (
    !cities ||
    cities.length <= 1
  ) {
    return properties.slice(0, limit);
  }

  const cityLowerSet = new Set(
    cities.map((c) => c.toLowerCase())
  );

  const byCity = {};

  for (const city of cities) {
    byCity[city.toLowerCase()] = [];
  }

  for (const prop of properties) {
    const propCity = (
      prop.city || ''
    )
      .toLowerCase()
      .trim();

    if (cityLowerSet.has(propCity)) {
      byCity[propCity].push(prop);
    }
  }

  const result = [];
  const cityKeys = cities.map((c) =>
    c.toLowerCase()
  );
  let index = 0;

  while (result.length < limit) {
    let added = false;

    for (const cityKey of cityKeys) {
      const cityProps =
        byCity[cityKey] || [];

      if (index < cityProps.length) {
        result.push(cityProps[index]);
        added = true;

        if (result.length >= limit) {
          break;
        }
      }
    }

    if (!added) break;
    index++;
  }

  return result;
};

/*
 * Check if there is any explicit bedroom requirement.
 */
const hasBedroomRequirement = (
  criteria
) => {
  switch (
    criteria.bedroomFilterType
  ) {
    case 'exact':
    case 'minimum':
      return criteria.bedrooms > 0;

    case 'or':
      return (
        criteria.bedroomOptions.length > 0
      );

    case 'range':
      return (
        criteria.bedroomMin > 0 ||
        criteria.bedroomMax > 0
      );

    default:
      return false;
  }
};

/*
 * Check if there is any explicit bathroom requirement.
 */
const hasBathroomRequirement = (
  criteria
) => {
  switch (
    criteria.bathroomFilterType
  ) {
    case 'exact':
    case 'minimum':
      return criteria.bathrooms > 0;

    case 'or':
      return (
        criteria.bathroomOptions.length > 0
      );

    case 'range':
      return (
        criteria.bathroomMin > 0 ||
        criteria.bathroomMax > 0
      );

    default:
      return false;
  }
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

      console.log(
        `[AI Search] Cities: ${criteria.cities.join(', ')}`
      );

      /*
       * Search Zameen for each city.
       */
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
            criteria.propertyType,
            criteria
          );

        console.log(
          `[AI Search] ${city}: found ${cityResults.length} listings`
        );

        scrapedProperties.push(
          ...cityResults
        );
      }

      console.log(
        `[AI Search] Total scraped: ${scrapedProperties.length}`
      );

      let properties =
        scrapedProperties.map(
          normalizeProperty
        );

      const bedroomReq =
        hasBedroomRequirement(criteria);
      const bathroomReq =
        hasBathroomRequirement(criteria);

      /*
       * Property type filter.
       */
      if (
        criteria.propertyType &&
        criteria.propertyType !== 'all'
      ) {
        properties = properties.filter(
          (property) => {
            const propType = (
              property.type ||
              property.propertyType ||
              ''
            )
              .toLowerCase()
              .trim();

            return (
              propType ===
                criteria.propertyType ||
              propType.includes(
                criteria.propertyType
              ) ||
              criteria.propertyType.includes(
                propType
              )
            );
          }
        );
      }

      /*
       * Bedroom filter.
       */
      if (bedroomReq) {
        const bedroomFiltered =
          properties.filter((property) =>
            matchesBedroomFilter(
              property.bedrooms,
              criteria
            )
          );

        const bedDesc =
          criteria.bedroomFilterType ===
          'or'
            ? `${criteria.bedroomOptions.join(
                '/'
              )}`
            : criteria.bedroomFilterType ===
              'range'
              ? `${criteria.bedroomMin}-${criteria.bedroomMax}`
              : criteria.bedroomFilterType ===
                'minimum'
                ? `${criteria.bedrooms}+`
                : `${criteria.bedrooms}`;

        console.log(
          `[AI Search] Bedroom filter: ${bedDesc} ${criteria.bedroomFilterType} → ${bedroomFiltered.length}`
        );

        properties = bedroomFiltered;
      }

      /*
       * Keep a copy before budget filtering.
       * This allows us to explain why there are
       * no exact results.
       */
      const bedroomMatchedProperties =
        [...properties];

      /*
       * Bathroom filter.
       */
      if (bathroomReq) {
        const bathroomFiltered =
          properties.filter((property) =>
            matchesBathroomFilter(
              property.bathrooms,
              criteria
            )
          );

        const bathDesc =
          criteria.bathroomFilterType ===
          'or'
            ? `${criteria.bathroomOptions.join(
                '/'
              )}`
            : criteria.bathroomFilterType ===
              'range'
              ? `${criteria.bathroomMin}-${criteria.bathroomMax}`
              : criteria.bathroomFilterType ===
                'minimum'
                ? `${criteria.bathrooms}+`
                : `${criteria.bathrooms}`;

        console.log(
          `[AI Search] Bathroom filter: ${bathDesc} ${criteria.bathroomFilterType} → ${bathroomFiltered.length}`
        );

        properties = bathroomFiltered;
      }

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

              if (
                priceInCrores === 0
              ) {
                return false;
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

        let budgetDesc = '';
        if (
          criteria.minBudgetInCrores >
            0 &&
          criteria.maxBudgetInCrores > 0
        ) {
          budgetDesc = `${criteria.minBudgetInCrores}-${criteria.maxBudgetInCrores} crore`;
        } else if (
          criteria.maxBudgetInCrores > 0
        ) {
          budgetDesc = `<= ${criteria.maxBudgetInCrores} crore`;
        } else if (
          criteria.minBudgetInCrores > 0
        ) {
          budgetDesc = `>= ${criteria.minBudgetInCrores} crore`;
        }

        console.log(
          `[AI Search] Budget filter: ${budgetDesc} → ${budgetFiltered.length}`
        );

        properties = budgetFiltered;
      }

      /*
       * Build a helpful no-results summary.
       */
      let searchSummary =
        '';
      let isFallback = false;

      const bedroomText =
        getBedroomText(criteria);
      const bathroomText =
        getBathroomText(criteria);

      const requirementParts = [];
      if (bedroomText)
        requirementParts.push(
          bedroomText
        );
      if (bathroomText)
        requirementParts.push(
          bathroomText
        );
      const requirementText =
        requirementParts.length > 0
          ? requirementParts.join(' and ')
          : 'your';

      if (
        properties.length === 0
      ) {
        if (
          bedroomMatchedProperties.length ===
          0
        ) {
          const cityList =
            criteria.cities.join(
              ', '
            );

          searchSummary =
            `No properties matching your ${requirementText} requirement were found in ${cityList}.`;
        } else {
          const reqParts = [];
          if (bedroomText)
            reqParts.push(bedroomText);
          if (bathroomText)
            reqParts.push(bathroomText);
          const reqText =
            reqParts.length > 0
              ? reqParts.join(' and ')
              : 'matching';

          let budgetText = '';
          if (
            criteria.maxBudgetInCrores >
            0
          ) {
            budgetText = `under Rs. ${criteria.maxBudgetInCrores} Crore`;
          } else if (
            criteria.minBudgetInCrores >
            0
          ) {
            budgetText = `above Rs. ${criteria.minBudgetInCrores} Crore`;
          }

          const priceRange =
            bedroomMatchedProperties
              .map((p) =>
                extractPriceInCrores(
                  p.price
                )
              )
              .filter((p) => p > 0);

          if (
            priceRange.length > 0
          ) {
            const minPrice =
              Math.min(...priceRange);
            const maxPrice =
              Math.max(...priceRange);

            searchSummary = budgetText
              ? `No ${reqText} properties found ${budgetText}. Showing closest alternatives (Rs. ${minPrice}\u2013${maxPrice} Crore).`
              : `No ${reqText} properties found. Showing closest alternatives (Rs. ${minPrice}\u2013${maxPrice} Crore).`;
          } else {
            searchSummary = `No exact matches found. Showing the closest alternatives.`;
          }

          isFallback = true;

          const targetBudget =
            criteria.maxBudgetInCrores >
            0
              ? criteria.maxBudgetInCrores
              : criteria.minBudgetInCrores >
                  0
                ? criteria.minBudgetInCrores
                : 0;

          const sortedFallback =
            bedroomMatchedProperties
              .sort((a, b) => {
                const aPrice =
                  extractPriceInCrores(
                    a.price
                  );
                const bPrice =
                  extractPriceInCrores(
                    b.price
                  );

                if (
                  targetBudget > 0
                ) {
                  return (
                    Math.abs(
                      aPrice -
                        targetBudget
                    ) -
                    Math.abs(
                      bPrice -
                        targetBudget
                    )
                  );
                }

                return aPrice - bPrice;
              });

          properties =
            distributeFairly(
              sortedFallback,
              criteria.cities,
              MAX_RESULTS
            );
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

        properties = distributeFairly(
          properties,
          criteria.cities,
          MAX_RESULTS
        );
      }

      console.log(
        `[AI Search] Search summary: ${searchSummary}`
      );

      if (
        criteria.cities.length > 1
      ) {
        console.log(
          '[AI Search] Final result distribution:'
        );

        for (
          const city of criteria.cities
        ) {
          const count =
            properties.filter(
              (p) =>
                (p.city || '')
                  .toLowerCase() ===
                city.toLowerCase()
            ).length;

          console.log(
            `  ${city}: ${count}`
          );
        }
      }

      console.log(
        `[AI Search] Returning ${properties.length} properties`
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
        isFallback,
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
