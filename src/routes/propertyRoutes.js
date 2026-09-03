// propertyRoutes.js
import express from 'express';
import { getProperties } from '../controllers/propertyController.js';

const router = express.Router();

router.route('/')
  .get(getProperties);

export default router;