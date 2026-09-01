import Inquiry from '../models/Inquiry.js';

// @desc    Submit a new property inquiry
// @route   POST /api/inquiries
// @access  Public
export const createInquiry = async (req, res) => {
  try {
    const { propertyId, name, email, phone, message, userId } = req.body;

    if (!propertyId || !name || !email || !phone || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const inquiry = await Inquiry.create({
      property: propertyId,
      name,
      email,
      phone,
      message,
      user: userId || null,
    });

    res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully!',
      data: inquiry,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all inquiries (For admin or user dashboard)
// @route   GET /api/inquiries
// @access  Public
export const getInquiries = async (req, res) => {
  try {
    const inquiries = await Inquiry.find().populate('property', 'title location price');
    res.status(200).json(inquiries);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};