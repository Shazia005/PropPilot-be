import mongoose from 'mongoose';

const inquirySchema = new mongoose.Schema(
  {
    propertyId: {
      type: String,
      required: true,
    },
    propertyTitle: {
      type: String,
    },
    name: {
      type: String,
      required: [true, 'Please add your name'],
    },
    email: {
      type: String,
      required: [true, 'Please add your email'],
    },
    phone: {
      type: String,
      required: [true, 'Please add your phone number'],
    },
    message: {
      type: String,
      required: [true, 'Please add a message'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Inquiry', inquirySchema);