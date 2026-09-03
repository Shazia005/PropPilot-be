// aiRoutes.js
import express from 'express';
import { autonomousSearch, propertyChat } from '../controllers/aiSearchController.js';

const router = express.Router();

router.post('/agent-search', autonomousSearch);
router.post('/property-chat', propertyChat);

export default router;