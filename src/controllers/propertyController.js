import Property from '../models/Property.js';

// @desc    Get all properties (with filtering, search, and sorting)
// @route   GET /api/properties
// @access  Public
export const getProperties = async (req, res) => {
  try {
    const { search, city, type, category, maxPrice, minPrice, beds, bedrooms, sort } = req.query;
    let query = {};

    // 1. Text Search across title, location, and city
    if (search && search.trim() !== '') {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { location: new RegExp(search, 'i') },
        { city: new RegExp(search, 'i') },
      ];
    }

    // 2. Location Filter
    if (city && city !== 'All' && city.trim() !== '') {
      query.city = new RegExp(city, 'i');
    }

    // 3. Category / Type Filter
    const selectedType = type || category;
    if (selectedType && selectedType !== 'All' && selectedType.trim() !== '') {
      query.$or = [
        { type: new RegExp(`^${selectedType}$`, 'i') },
        { category: new RegExp(`^${selectedType}$`, 'i') }
      ];
    }

    // 4. Bedroom Count Filter
    const bedCount = beds || bedrooms;
    if (bedCount && bedCount !== 'All') {
      const minBeds = parseInt(String(bedCount).replace('+', ''), 10);
      if (!isNaN(minBeds)) {
        query.$or = [
          { bedrooms: { $gte: minBeds } },
          { beds: { $gte: minBeds } }
        ];
      }
    }

    // 5. Price Range Filter
    if ((minPrice && !isNaN(minPrice)) || (maxPrice && !isNaN(maxPrice))) {
      const priceQuery = {};
      if (minPrice && !isNaN(minPrice)) priceQuery.$gte = Number(minPrice);
      if (maxPrice && !isNaN(maxPrice)) priceQuery.$lte = Number(maxPrice);

      query.$or = [
        { price: priceQuery },
        { priceNumeric: priceQuery }
      ];
    }

    // 6. Sorting Setup
    let sortOptions = {};
    if (sort === 'price_asc') sortOptions.price = 1;
    else if (sort === 'price_desc') sortOptions.price = -1;
    else if (sort === 'newest') sortOptions.createdAt = -1;

    const properties = await Property.find(query).sort(sortOptions);
    res.status(200).json(properties);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single property by ID
// @route   GET /api/properties/:id
// @access  Public
export const getPropertyById = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }
    res.status(200).json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new property
// @route   POST /api/properties
// @access  Public
export const createProperty = async (req, res) => {
  try {
    const newProperty = new Property(req.body);
    const savedProperty = await newProperty.save();
    res.status(201).json(savedProperty);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};