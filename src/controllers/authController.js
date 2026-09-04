import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const generateToken = (id) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const error = new Error(
      'JWT_SECRET is not defined in environment variables. Please add JWT_SECRET to your .env file'
    );
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign({ id }, secret, {
    expiresIn: '30d',
  });
};

// Exported as 'login' to match authRoutes.js import
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter email and password.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      savedProperties: user.savedProperties || [],
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: 'Login failed.', details: error.message });
  }
};

// Exported as 'register' to match authRoutes.js import
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide name, email, and password.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email.' });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user._id);

    return res.status(201).json({
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      savedProperties: [],
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: 'Registration failed.', details: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await User.findById(userId).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
  }
};

export const toggleSaveProperty = async (req, res) => {
  try {
    const { propertyId } = req.body;

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'You must be logged in to save properties' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const propertyStringId = String(propertyId);
    const index = user.savedProperties.findIndex(
      (id) => String(id) === propertyStringId
    );

    if (index > -1) {
      user.savedProperties.splice(index, 1);
    } else {
      user.savedProperties.push(propertyStringId);
    }

    await user.save();
    return res.status(200).json({
      success: true,
      savedProperties: user.savedProperties,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update saved properties', details: error.message });
  }
};