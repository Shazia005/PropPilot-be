import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Property from './models/Property.js';
import connectDB from './config/db.js';

dotenv.config();
connectDB();

const sampleProperties = [
  {
    title: "Luxury Modern Villa",
    description: "Architectural masterpiece featuring floor-to-ceiling windows, private swimming pool, landscaped garden, and smart home automation in prime DHA Phase 5.",
    type: "Villa",
    city: "Islamabad",
    location: "DHA Phase 5, Islamabad",
    price: 4.5,
    bedrooms: 5,
    bathrooms: 6,
    areaSqFt: 4500,
    imageUrl: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
    images: [
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80"
    ],
    features: ["Swimming Pool", "Garden", "Parking", "Smart Automation"],
    aiHighlights: ["Prime Location", "High Resale Value", "Modern Architecture"],
    agent: {
      name: "Tariq Malik",
      phone: "+92 300 1234567",
      image: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=200&q=80"
    }
  },
  {
    title: "Contemporary Apartment in F-11",
    description: "Elegant 3-bedroom luxury apartment with modern amenities, underground parking, and scenic views of the Margalla Hills.",
    type: "Apartment",
    city: "Islamabad",
    location: "F-11 Markaz, Islamabad",
    price: 1.8,
    bedrooms: 3,
    bathrooms: 3,
    areaSqFt: 2200,
    imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80",
    images: [
      "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80"
    ],
    features: ["Parking", "Gym Access", "24/7 Security", "Elevator"],
    aiHighlights: ["Margalla View", "Central Location", "Strong Rental Yield"],
    agent: {
      name: "Saima Khan",
      phone: "+92 321 9876543",
      image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80"
    }
  }
];

const seedData = async () => {
  try {
    await Property.deleteMany();
    await Property.insertMany(sampleProperties);
    console.log('Database Seeded Successfully!');
    process.exit();
  } catch (error) {
    console.error(`Error with seeding: ${error.message}`);
    process.exit(1);
  }
};

seedData();