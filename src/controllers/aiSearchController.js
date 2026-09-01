import { GoogleGenAI, Type } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const autonomousSearch = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY is missing in server .env file' });
    }

    // Step 1: Extract criteria using Gemini
    const intentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
    });

    const criteria = JSON.parse(intentResponse.text);

    // Step 2: Scrape listings
    const rawData = await scrapeListings(criteria.city || 'Lahore', criteria.propertyType || 'House');

    // Step 3: Format and normalize listings using Gemini
    const normalizationResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Format raw scraped listings into valid property cards matching user prompt: "${prompt}". 
      Extracted criteria: ${JSON.stringify(criteria)}
      Raw data: ${JSON.stringify(rawData)}`,
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
    });

    const finalOutput = JSON.parse(normalizationResponse.text);
    return res.status(200).json(finalOutput);

  } catch (error) {
    console.error('AI Pipeline Error:', error);
    return res.status(500).json({ message: 'Search processing failed.', error: error.message });
  }
};