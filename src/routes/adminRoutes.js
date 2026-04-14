import { Router } from "express";
import {
  getAdminAnalytics,
  getAdminDashboard,
  getAdminDisputes,
  getAdminStaffManagement,
} from "../controllers/adminController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.get("/dashboard", getAdminDashboard);
adminRouter.get("/analytics", getAdminAnalytics);
adminRouter.get("/disputes", getAdminDisputes);
adminRouter.get("/staff", getAdminStaffManagement);

export default adminRouter;
