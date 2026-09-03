import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      
      // ✅ FIXED: Strict JWT_SECRET validation
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('[Auth Middleware] JWT_SECRET is missing in environment variables');
        return res.status(500).json({ message: 'Server configuration error: JWT_SECRET missing' });
      }
      
      const decoded = jwt.verify(token, secret);
      req.user = await User.findById(decoded.id).select('-password');
      
      // ✅ FIXED: Validate user exists
      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      next();
    } catch (error) {
      console.error('[Auth Middleware Error]:', error.message);
      
      // Handle specific JWT errors
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token has expired' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ message: 'Invalid token' });
      }
      
      return res.status(401).json({ message: 'Not authorized, token validation failed' });
    }
  } else {
    return res.status(401).json({ message: 'Not authorized, token missing' });
  }
};
