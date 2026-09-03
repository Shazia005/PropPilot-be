import { GoogleGenAI, Type } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

// Helper: Wrap async tasks with strict timeouts
const withTimeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    )
  ]);
};

// Controller 1: Autonomous Search & Listing Normalization
export const autonomousSearch = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || prompt.trim() === '') {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY missing in .env file' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Step 1: Extract criteria with a 10s timeout
    const intentResponse = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `Extract real estate search criteria from this prompt: "${prompt}".`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              city: { type: Type.STRING },
              maxBudgetInCrores: { type: Type.NUMBER },
              bedrooms: { type: Type.NUMBER },
              propertyType: { type: Type.STRING }
            },
            required: ['city', 'propertyType']
          }
        }
      }),
      10000
    );

    let criteria;
    try {
      criteria = JSON.parse(intentResponse.text);
    } catch (parseErr) {
      return res.status(400).json({ message: 'Failed to process prompt intent.' });
    }

    // Validate extracted city
    if (!criteria.city || criteria.city.trim() === '') {
      return res.status(400).json({ 
        message: 'Could not determine city from your search. Please specify a Pakistani city.',
        suggestedCities: ['Islamabad', 'Lahore', 'Karachi', 'Rawalpindi', 'Peshawar']
      });
    }

    if (!criteria.propertyType || criteria.propertyType.trim() === '') {
      criteria.propertyType = 'House';
    }

    console.log(`[AI Search] City: ${criteria.city} | Type: ${criteria.propertyType}`);

    // Step 2: Scrape live listings
    let rawData = [];
    try {
      rawData = await scrapeListings(criteria.city, criteria.propertyType);
    } catch (scrapeErr) {
      console.error('[Scraper Error]:', scrapeErr.message);
      return res.status(503).json({ 
        message: 'Unable to fetch data from Zameen.com. Please try again later.',
        error: scrapeErr.message 
      });
    }

    // Validate scraped data presence and layout
    if (!rawData || rawData.length === 0) {
      return res.status(404).json({ 
        message: `No properties found for "${criteria.propertyType}" in "${criteria.city}" on Zameen.com`,
        properties: [],
        aiSummary: 'No listings currently available in this location.'
      });
    }

    const validData = rawData.filter(item => item.rawTitle || item.rawPrice);
    if (validData.length === 0) {
      return res.status(422).json({ 
        message: 'Scraped data is incomplete or unparseable.',
        properties: []
      });
    }

    console.log(`[AI Search] Processing ${validData.length} scraped properties through Gemini...`);

    // Step 3: Format output with 15s timeout
    const normalizationResponse = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `Format raw property listings into valid property cards matching user prompt: "${prompt}". 
        Extracted criteria: ${JSON.stringify(criteria)}
        Raw data: ${JSON.stringify(validData)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              aiSummary: { type: Type.STRING },
              properties: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    price: { type: Type.STRING },
                    location: { type: Type.STRING },
                    beds: { type: Type.NUMBER },
                    baths: { type: Type.NUMBER },
                    area: { type: Type.STRING },
                    image: { type: Type.STRING },
                    type: { type: Type.STRING }
                  },
                  required: ['id', 'title', 'price', 'location']
                }
              }
            },
            required: ['aiSummary', 'properties']
          }
        }
      }),
      15000
    );

    let finalOutput;
    try {
      finalOutput = JSON.parse(normalizationResponse.text);
    } catch (parseErr) {
      console.error('[Parse Error] Failed to parse Gemini response JSON');
      return res.status(502).json({ 
        message: 'AI formatting failed. Returning raw scraper data as fallback.',
        properties: validData 
      });
    }

    if (!finalOutput.properties || !Array.isArray(finalOutput.properties)) {
      return res.status(502).json({ 
        message: 'Invalid response structure from AI model.',
        properties: validData 
      });
    }

    return res.status(200).json(finalOutput);

  } catch (error) {
    console.error('[AI Search Error]:', error.message);
    return res.status(500).json({ 
      message: 'Search processing failed.', 
      error: error.message 
    });
  }
};

// Controller 2: Interactive Property Assistant Chat
export const propertyChat = async (req, res) => {
  try {
    const { message, propertyContext } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY missing in .env file' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let promptContent = message;
    if (propertyContext && typeof propertyContext === 'object') {
      const contextStr = JSON.stringify(propertyContext);
      if (contextStr.length > 2500) {
        return res.status(400).json({ message: 'Property context payload is too large' });
      }
      promptContent = `You are an expert real estate consultant. Context of the property being discussed: ${contextStr}. User question: ${message}`;
    }

    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: promptContent,
      }),
      10000
    );

    if (!response || !response.text) {
      return res.status(500).json({ message: 'No text response returned from AI model.' });
    }

    return res.status(200).json({ reply: response.text });
  } catch (error) {
    console.error('[Property Chat Error]:', error.message);
    return res.status(500).json({
      message: 'Failed to generate chat response.',
      error: error.message,
    });
  }
};