import mongoose from 'mongoose';

const inquirySchema = new mongoose.Schema(
  {
    propertyId: { type: String, required: true },
    propertyTitle: { type: String },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Inquiry', inquirySchema);