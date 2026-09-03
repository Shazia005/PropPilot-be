import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    // ✅ FIXED: Validate MONGO_URI exists
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI not defined in environment variables. Please add it to your .env file');
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: true,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
