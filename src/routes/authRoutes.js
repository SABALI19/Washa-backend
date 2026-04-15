import { Router } from "express";
import {
  login,
  logout,
  me,
  refresh,
  signup,
  updateProfileImage,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
authRouter.patch("/profile-image", requireAuth, updateProfileImage);

export default authRouter;
