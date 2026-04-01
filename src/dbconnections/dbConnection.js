import mongoose from "mongoose";


// function to connect to mongodb
export const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Database connection successful!");
  } catch (e) {
    console.log(`mongoDB connection error: ${e.message}`);
  }
};

export default connectDB;