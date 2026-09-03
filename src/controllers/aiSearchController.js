import { GoogleGenAI, Type } from '@google/genai';
import { scrapeListings } from '../services/scraper.js';

// Controller 1: Autonomous Search & Listing Normalization
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

    // Step 1: Extract criteria using Gemini 3.6 Flash
    const intentResponse = await ai.models.generateContent({
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
    });

    const criteria = JSON.parse(intentResponse.text);

    // Step 2: Scrape live listings directly from Zameen.com
    let rawData = [];
    try {
      rawData = await scrapeListings(criteria.city || 'Lahore', criteria.propertyType || 'House');
      
      if (!rawData || rawData.length === 0) {
        return res.status(404).json({ 
          message: `No properties found in ${criteria.city} for type ${criteria.propertyType} on Zameen.com.`,
          properties: []
        });
      }
    } catch (scrapeErr) {
      console.error('Scraper Error:', scrapeErr.message);
      return res.status(503).json({ 
        message: 'Unable to fetch data from Zameen.com. Please try again later.',
        error: scrapeErr.message 
      });
    }

    // Step 3: Format and normalize scraped results using Gemini 3.6 Flash
    const normalizationResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
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

// Controller 2: Interactive Property Assistant Chat
export const propertyChat = async (req, res) => {
  try {
    const { message, propertyContext } = req.body;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY missing in .env file' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let promptContent = message;
    if (propertyContext) {
      promptContent = `You are an expert real estate consultant. Context of the property being discussed: ${JSON.stringify(propertyContext)}. User question: ${message}`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptContent,
    });

    return res.status(200).json({
      reply: response.text,
    });
  } catch (error) {
    console.error('Property Chat Error:', error);
    return res.status(500).json({
      message: 'Failed to generate chat response.',
      error: error.message,
    });
  }
};