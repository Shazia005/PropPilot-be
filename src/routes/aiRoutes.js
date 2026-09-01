import express from 'express';
import { autonomousSearch } from '../controllers/aiSearchController.js';

const router = express.Router();

router.post('/agent-search', autonomousSearch);

export default router;