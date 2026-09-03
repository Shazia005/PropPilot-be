import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', {
    expiresIn: '30d',
  });
};

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
    return res.status(500).json({ error: 'Login failed.', details: error.message });
  }
};

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
    return res.status(500).json({ error: 'Registration failed.', details: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id;
    // Removed .populate('savedProperties')
    const user = await User.findById(userId).select('-password');
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
  }
};

export const toggleSaveProperty = async (req, res) => {
  try {
    const { userId, propertyId } = req.body;

    const user = await User.findById(userId || req.user?.id);
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
    return res.status(200).json({ savedProperties: user.savedProperties });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update saved properties', details: error.message });
  }
};