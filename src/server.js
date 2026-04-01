import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./dbconnections/dbConnection.js";
import authRouter from "./routes/authRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9000;

const validateEnvironment = () => {
  const requiredVariables = ["MONGODB_URI"];

  if (process.env.NODE_ENV === "production") {
    requiredVariables.push("AUTH_SECRET");
  }

  const missingVariables = requiredVariables.filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVariables.join(", ")}`);
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.get("/", (req, res) => {
  res.send("Welcome to Washa Server");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Washa backend is running." });
});

app.use("/api/auth", authRouter);

const startServer = async () => {
  try {
    validateEnvironment();
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server is listening to PORT ${PORT}`);
    });
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  }
};

startServer();
