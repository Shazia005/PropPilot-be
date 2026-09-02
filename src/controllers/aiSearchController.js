import { GoogleGenAI, Type } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';
import Property from '../models/Property.js';

export const autonomousSearch = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY missing in .env file' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Step 1: Extract criteria using Gemini
    const intentResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash', // FIXED: Updated model string
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

    // Step 2: Attempt scraping with DB fallback on error
    let rawData = [];
    try {
      rawData = await scrapeListings(criteria.city || 'Lahore', criteria.propertyType || 'House');
    } catch (scrapeErr) {
      console.warn('Scraper failed or timed out. Falling back to DB search...', scrapeErr.message);
    }

    if (!rawData || rawData.length === 0) {
      const dbQuery = {};
      if (criteria.city) dbQuery.city = { $regex: criteria.city, $options: 'i' };
      if (criteria.propertyType) dbQuery.type = { $regex: criteria.propertyType, $options: 'i' };

      const dbProperties = await Property.find(dbQuery).limit(10);
      
      rawData = dbProperties.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        price: p.price,
        location: p.location,
        beds: p.bedrooms || 3,
        baths: p.bathrooms || 3,
        area: p.areaSqFt ? `${p.areaSqFt} Sq Ft` : '10 Marla',
        image: p.imageUrl || 'https://via.placeholder.com/400x300',
        type: p.type
      }));
    }

    // Step 3: Format response using Gemini
    const normalizationResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash', // FIXED: Updated model string
      contents: `Format raw property listings into valid property cards matching user prompt: "${prompt}". 
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
    console.error('AI Search Error:', error);
    return res.status(500).json({ 
      message: 'Search processing failed.', 
      error: error.message 
    });
  }
};