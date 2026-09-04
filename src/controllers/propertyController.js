// @desc    Get properties
// @route   GET /api/properties
// @access  Public
export const getProperties = async (req, res) => {
  try {
    // Do not scrape Zameen here.
    // Live scraping is handled by the AI agent search endpoint.
    return res.status(200).json([]);
  } catch (error) {
    console.error('Error fetching properties:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch properties',
      properties: [],
    });
  }
};