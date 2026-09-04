import { GoogleGenAI, Type } from "@google/genai";
import { scrapeListings } from "../services/scraper.js";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT = 30000;

// Initialize Gemini only if API key exists
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

/* =========================================================
   TIMEOUT HELPER
========================================================= */

const withTimeout = (promise, ms) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Operation timed out after " + ms + "ms"));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

/* =========================================================
   PRICE PARSER
========================================================= */

const extractPriceInCrores = (price) => {
  if (!price) return 0;

  const text = String(price).toLowerCase().replace(/,/g, "");

  // Example: 2.5 Crore
  const croreMatch = text.match(/([\d.]+)\s*crore/);

  if (croreMatch) {
    return Number(croreMatch[1]);
  }

  // Example: 25 Million
  const millionMatch = text.match(/([\d.]+)\s*million/);

  if (millionMatch) {
    return Number(millionMatch[1]) / 10;
  }

  // Example: 25000000
  const numberMatch = text.match(/[\d.]+/);

  if (numberMatch) {
    const value = Number(numberMatch[0]);

    if (value >= 10000000) {
      return value / 10000000;
    }
  }

  return 0;
};

/* =========================================================
   NORMALIZE SCRAPED PROPERTY
========================================================= */

const normalizeProperty = (property, index) => {
  if (!property || typeof property !== "object") {
    return null;
  }

  const id =
    property.id ||
    property._id ||
    property.propertyId ||
    property.rawId ||
    `ai-property-${index}-${Date.now()}`;

  return {
    id: String(id),

    title:
      property.title ||
      property.name ||
      property.rawTitle ||
      "Property Listing",

    price:
      property.price ||
      property.priceText ||
      property.amount ||
      property.rawPrice ||
      "Price not available",

    location:
      property.location ||
      property.address ||
      property.rawLocation ||
      property.city ||
      "Location not available",

    beds:
      property.beds ??
      property.bedrooms ??
      property.bedroom ??
      property.rawBedrooms ??
      0,

    bedrooms:
      property.bedrooms ??
      property.beds ??
      property.bedroom ??
      property.rawBedrooms ??
      0,

    baths:
      property.baths ??
      property.bathrooms ??
      property.bathroom ??
      property.rawBathrooms ??
      0,

    bathrooms:
      property.bathrooms ??
      property.baths ??
      property.bathroom ??
      property.rawBathrooms ??
      0,

    area:
      property.area ||
      property.areaSqFt ||
      property.sqft ||
      property.size ||
      property.rawArea ||
      "N/A",

    areaSqFt:
      property.areaSqFt ||
      property.sqft ||
      property.area ||
      property.rawArea ||
      "N/A",

    image:
      property.image ||
      property.imageUrl ||
      property.img ||
      property.rawImage ||
      "",

    imageUrl:
      property.imageUrl ||
      property.image ||
      property.rawImage ||
      "",

    type:
      property.type ||
      property.propertyType ||
      "Property",

    sourceUrl:
      property.sourceUrl ||
      property.url ||
      property.link ||
      property.rawLink ||
      "",
  };
};

/* =========================================================
   UNIQUE IDS
========================================================= */

const makeUniqueIds = (properties) => {
  const usedIds = new Set();

  return properties.map((property, index) => {
    let id = String(property.id || `property-${index}`);

    if (usedIds.has(id)) {
      id = `${id}-${index}`;
    }

    usedIds.add(id);

    return {
      ...property,
      id,
    };
  });
};

/* =========================================================
   FALLBACK SEARCH DETECTION
   Used when Gemini quota is unavailable
========================================================= */

const detectFallbackCriteria = (prompt) => {
  const text = String(prompt || "").toLowerCase();

  let city = null;
  let propertyType = null;
  let bedrooms = 0;
  let maxBudgetInCrores = 0;

  // Cities
  const cities = [
    "islamabad",
    "lahore",
    "karachi",
    "rawalpindi",
    "peshawar",
    "faisalabad",
    "multan",
    "quetta",
  ];

  for (const cityName of cities) {
    if (text.includes(cityName)) {
      city = cityName;
      break;
    }
  }

  // Property type
  if (
    text.includes("house") ||
    text.includes("home") ||
    text.includes("villa")
  ) {
    propertyType = "house";
  } else if (
    text.includes("apartment") ||
    text.includes("flat")
  ) {
    propertyType = "apartment";
  } else if (text.includes("plot")) {
    propertyType = "plot";
  } else if (
    text.includes("commercial") ||
    text.includes("office") ||
    text.includes("shop")
  ) {
    propertyType = "commercial";
  } else {
    propertyType = "house";
  }

  // Bedrooms
  const bedroomMatch = text.match(
    /(\d+)\s*(?:bedroom|bedrooms|bed|beds|bhk)/
  );

  if (bedroomMatch) {
    bedrooms = Number(bedroomMatch[1]);
  }

  // Budget
  const croreMatch = text.match(
    /(?:under|below|less than|max|maximum|budget(?:\s+of)?|upto|up to)?\s*(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)/
  );

  if (croreMatch) {
    maxBudgetInCrores = Number(croreMatch[1]);
  }

  return {
    city,
    propertyType,
    bedrooms,
    maxBudgetInCrores,
  };
};

/* =========================================================
   GEMINI ERROR HANDLER
========================================================= */

const handleGeminiError = (error) => {
  const message = error?.message || String(error);

  console.error("[Gemini Error]:", message);

  if (
    message.includes("429") ||
    message.toLowerCase().includes("quota") ||
    message.toLowerCase().includes("resource_exhausted")
  ) {
    return "Gemini API quota has been exceeded. Please try again later.";
  }

  if (
    message.toLowerCase().includes("api key") ||
    message.toLowerCase().includes("unauthorized") ||
    message.toLowerCase().includes("permission")
  ) {
    return "Gemini API authentication failed. Please check your API key.";
  }

  if (message.toLowerCase().includes("timed out")) {
    return "Gemini request timed out. Please try again.";
  }

  return "AI service is temporarily unavailable.";
};

/* =========================================================
   AI AGENT SEARCH
========================================================= */

export const autonomousSearch = async (req, res) => {
  try {
    const prompt = req.body?.prompt || req.body?.query || "";

    if (!prompt.trim()) {
      return res.status(400).json({
        message: "Please provide a property search prompt.",
        properties: [],
      });
    }

    console.log("\n========================================");
    console.log("[AI Search] User prompt:", prompt);
    console.log("========================================");

    let criteria = null;
    let usedFallback = false;

    /* =====================================================
       STEP 1: GEMINI INTENT EXTRACTION
    ===================================================== */

    if (ai) {
      try {
        console.log("[AI Search] Extracting search intent...");

        const intentResponse = await withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: `
You are a real estate search assistant.

Analyze the user's property search request and return ONLY valid JSON.

User request:
"${prompt}"

Return this exact structure:

{
  "city": "karachi",
  "propertyType": "house",
  "bedrooms": 4,
  "maxBudgetInCrores": 5
}

Rules:
- city should be lowercase.
- propertyType must be one of:
  house, apartment, plot, commercial
- bedrooms should be a number. Use 0 if not specified.
- maxBudgetInCrores should be a number. Use 0 if no budget is specified.
- Do not include markdown.
- Do not include explanations.
            `,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  city: {
                    type: Type.STRING,
                  },
                  propertyType: {
                    type: Type.STRING,
                  },
                  bedrooms: {
                    type: Type.NUMBER,
                  },
                  maxBudgetInCrores: {
                    type: Type.NUMBER,
                  },
                },
                required: [
                  "city",
                  "propertyType",
                  "bedrooms",
                  "maxBudgetInCrores",
                ],
              },
            },
          }),
          GEMINI_TIMEOUT
        );

        const responseText =
          intentResponse?.text ||
          intentResponse?.response?.text ||
          "";

        console.log("[AI Search] Gemini response:", responseText);

        if (!responseText) {
          throw new Error("Gemini returned an empty response.");
        }

        criteria = JSON.parse(responseText);

        console.log("[AI Search] Parsed criteria:", criteria);
      } catch (error) {
        console.log(
          "[AI Search] Gemini unavailable. Switching to fallback search."
        );

        console.log("[AI Search] Reason:", error?.message || error);

        criteria = detectFallbackCriteria(prompt);
        usedFallback = true;

        console.log("[AI Search] Fallback criteria:", criteria);
        console.log("[AI Search] FALLBACK MODE ACTIVE");
      }
    } else {
      console.log(
        "[AI Search] Gemini API key not found. Using fallback search."
      );

      criteria = detectFallbackCriteria(prompt);
      usedFallback = true;

      console.log("[AI Search] Fallback criteria:", criteria);
      console.log("[AI Search] FALLBACK MODE ACTIVE");
    }

    /* =====================================================
       STEP 2: VALIDATE CRITERIA
    ===================================================== */

    if (!criteria) {
      return res.status(400).json({
        message: "Unable to understand your property search.",
        properties: [],
      });
    }

    const city = String(criteria.city || "").toLowerCase().trim();

    let propertyType = String(
      criteria.propertyType || "house"
    )
      .toLowerCase()
      .trim();

    const bedrooms = Number(criteria.bedrooms || 0);

    const maxBudgetInCrores = Number(
      criteria.maxBudgetInCrores || 0
    );

    if (!city) {
      return res.status(400).json({
        message:
          "Please specify a city, for example: 4 bedroom house in Karachi.",
        properties: [],
      });
    }

    // Normalize flat → apartment
    if (propertyType === "flat") {
      propertyType = "apartment";
    }

    console.log("[AI Search] Final search criteria:", {
      city,
      propertyType,
      bedrooms,
      maxBudgetInCrores,
    });

    /* =====================================================
       STEP 3: SCRAPE ZAMEEN
    ===================================================== */

    console.log("[AI Search] Starting property scraper...");

    let scrapedProperties = [];

    try {
      scrapedProperties = await scrapeListings(
        city,
        propertyType
      );

      console.log(
        `[AI Search] Scraper returned ${scrapedProperties.length} listings.`
      );
    } catch (scraperError) {
      console.error(
        "[AI Search] Scraper error:",
        scraperError?.message || scraperError
      );

      return res.status(500).json({
        message: "Unable to fetch property listings.",
        properties: [],
        fallbackMode: usedFallback,
      });
    }

    /* =====================================================
       STEP 4: NORMALIZE RESULTS
    ===================================================== */

    let properties = scrapedProperties
      .map((property, index) =>
        normalizeProperty(property, index)
      )
      .filter(Boolean);

    console.log(
      `[AI Search] Normalized ${properties.length} properties.`
    );

    /* =====================================================
       STEP 5: FILTER BY PROPERTY TYPE
    ===================================================== */

    if (propertyType) {
      const typeFiltered = properties.filter((property) => {
        const typeText = String(
          property.type || property.title || ""
        ).toLowerCase();

        if (propertyType === "house") {
          return (
            typeText.includes("house") ||
            typeText.includes("villa") ||
            typeText.includes("home")
          );
        }

        if (propertyType === "apartment") {
          return (
            typeText.includes("apartment") ||
            typeText.includes("flat")
          );
        }

        if (propertyType === "plot") {
          return typeText.includes("plot");
        }

        if (propertyType === "commercial") {
          return (
            typeText.includes("commercial") ||
            typeText.includes("office") ||
            typeText.includes("shop")
          );
        }

        return true;
      });

      // Only replace results if filtering found something
      if (typeFiltered.length > 0) {
        properties = typeFiltered;
      }
    }

  /* =====================================================
   STEP 6: FILTER BY BEDROOMS
=====================================================*/

if (bedrooms > 0) {
  properties = properties.filter((property) => {
    const propertyBedrooms = Number(
      property.bedrooms || property.beds || 0
    );

    return propertyBedrooms >= bedrooms;
  });

  console.log(
    `[AI Search] Bedroom filter (${bedrooms}+): ${properties.length} listings.`
  );
}
    /* =====================================================
       STEP 7: FILTER BY BUDGET
    ===================================================== */

    if (maxBudgetInCrores > 0) {
      const budgetFiltered = properties.filter((property) => {
        const priceInCrores = extractPriceInCrores(
          property.price
        );

        if (priceInCrores === 0) {
          return true;
        }

        return priceInCrores <= maxBudgetInCrores;
      });

      if (budgetFiltered.length > 0) {
        properties = budgetFiltered;
      }
    }

    /* =====================================================
       STEP 8: UNIQUE IDS
    ===================================================== */

    properties = makeUniqueIds(properties);

    /* =====================================================
       STEP 9: LIMIT RESULTS
    ===================================================== */

    properties = properties.slice(0, 10);

    console.log(
      `[AI Search] Returning ${properties.length} properties.`
    );

    if (properties.length > 0) {
      console.log(
        "[AI Search] First property:",
        JSON.stringify(properties[0], null, 2)
      );
    }

    /* =====================================================
       STEP 10: RESPONSE
    ===================================================== */

    return res.status(200).json({
      success: true,
      message: usedFallback
        ? "Properties found using fallback search."
        : "AI property search completed successfully.",
      fallbackMode: usedFallback,
      criteria: {
        city,
        propertyType,
        bedrooms,
        maxBudgetInCrores,
      },
      count: properties.length,
      properties,
    });
  } catch (error) {
    console.error(
      "[AI Search] Unexpected error:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      message: "Something went wrong while searching for properties.",
      properties: [],
    });
  }
};

/* =========================================================
   PROPERTY CHAT
========================================================= */

export const propertyChat = async (req, res) => {
  try {
    const message = req.body?.message || "";

    if (!message.trim()) {
      return res.status(400).json({
        message: "Please provide a message.",
      });
    }

    if (!ai) {
      return res.status(503).json({
        message:
          "Gemini API is not configured. Please add GEMINI_API_KEY.",
      });
    }

    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `
You are a helpful real estate assistant.

Answer the user's question clearly and briefly.

User:
${message}
        `,
      }),
      GEMINI_TIMEOUT
    );

    const text =
      response?.text ||
      response?.response?.text ||
      "I couldn't generate a response.";

    return res.status(200).json({
      success: true,
      message: text,
    });
  } catch (error) {
    console.error(
      "[Property Chat Error]:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      message: handleGeminiError(error),
    });
  }
};