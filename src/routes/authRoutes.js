// authRoutes.js
import express from 'express';
import { register, login, getProfile, toggleSaveProperty } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getProfile);
router.post('/save-property', protect, toggleSaveProperty);

export default router;