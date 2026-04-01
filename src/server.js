import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./dbconnections/dbConnection.js";
import authRouter from "./routes/authRoutes.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const PORT = process.env.PORT || 9000;

app.get("/", (req, res) => {
  res.send("Welcome to Washa Server");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Washa backend is running." });
});

app.use("/api/auth", authRouter);

const startSever = async () => {
  try {
    await connectDB();
    app.listen(PORT, async () => {
      console.log(`Server is listening to PORT ${PORT}`);
    });
  } catch (e) {
    console.log(`Sever could not connect due to database error: ${e.message}`);
  }
};

startSever();
