import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./dbconnections/dbConnection.js";
import authRouter from "./routes/authRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9000;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://washa.pxxl.click",
  "https://washa.pxxl.pro",
];

const getAllowedOrigins = () => {
  const configuredOrigins = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
};

const corsOptions = {
  origin(origin, callback) {
    const allowedOrigins = getAllowedOrigins();

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

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
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

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
