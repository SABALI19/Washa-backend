import mongoose from "mongoose";


// function to connect to mongodb
export const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Database connection successful!");
};

export default connectDB;
