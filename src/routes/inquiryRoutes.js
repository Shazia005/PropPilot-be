// inquiryRoutes.js
import express from 'express';
import { createInquiry, getInquiries } from '../controllers/inquiryController.js';

const router = express.Router();

router.route('/')
  .post(createInquiry)
  .get(getInquiries);

export default router;