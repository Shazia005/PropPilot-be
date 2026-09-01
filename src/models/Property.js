import mongoose from 'mongoose';

const propertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  type: { 
    type: String, 
    required: true, 
    enum: ['House', 'Villa', 'Apartment', 'Penthouse', 'Farmhouse'] 
  },
  city: { type: String, required: true },
  location: { type: String, required: true },
  price: { type: Number, required: true },
  bedrooms: { type: Number, required: true },
  bathrooms: { type: Number, required: true },
  areaSqFt: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  images: [{ type: String }],
  features: [{ type: String }],
  aiHighlights: [{ type: String }],
  agent: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    image: { type: String }
  }
}, { timestamps: true });

export default mongoose.model('Property', propertySchema);