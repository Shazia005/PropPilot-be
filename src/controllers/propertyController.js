import { scrapeListings } from '../services/scraper.js';

// @desc    Get properties live from Zameen.com
// @route   GET /api/properties
// @access  Public
export const getProperties = async (req, res) => {
  try {
    const { city = 'Islamabad', type = 'House' } = req.query;

    const properties = await scrapeListings(city, type);

    if (!properties || properties.length === 0) {
      return res.status(404).json({ 
        message: `No properties found in ${city} for type ${type}`,
        properties: []
      });
    }

    res.status(200).json(properties);
  } catch (error) {
    console.error('Error fetching properties:', error.message);
    res.status(503).json({ 
      message: 'Unable to fetch data from Zameen.com',
      error: error.message 
    });
  }
};