import { Router } from "express";
import { login, me, signup } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);

export default authRouter;
