import express from "express";
import dotenv from "dotenv";
import path from "path";
import connectDB from "./dbconnections/dbConnection.js";
import authRouter from "./routes/authRoutes.js";
import ordersRouter from "./routes/orderRoutes.js";

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
    .map((origin) => origin.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  return configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
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

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  const isAllowed =
    requestOrigin &&
    (allowedOrigins.includes(requestOrigin) ||
      /^https:\/\/[a-z0-9-]+\.devtunnels\.ms$/.test(requestOrigin));

  if (isAllowed) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.get("/", (req, res) => {
  res.send("Welcome to Washa Server");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Washa backend is running." });
});

// TEMPORARY - remove after debugging
app.get("/api/debug-cors", (req, res) => {
  res.json({
    allowedOrigins: getAllowedOrigins(),
    rawEnvValue: process.env.CORS_ORIGIN,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);

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
