import { Router } from "express";
import {
  createDraft,
  deleteDraft,
  getCustomerDraftById,
  getLatestCustomerDraft,
  updateDraft,
} from "../controllers/orderDraftController.js";
import {
  cancelCustomerOrder,
  clockInStaffAttendance,
  clockOutStaffAttendance,
  createCustomerOrderShareLink,
  createOrder,
  getCustomerOrderById,
  getCustomerOrders,
  getSharedPickupOrder,
  getStaffAttendanceStatus,
  getStaffDashboard,
  getStaffPickupSchedule,
  getStaffVerificationOrder,
  updateStaffPickupCapacity,
  updateStaffVerificationOrder,
  updateCustomerOrder,
} from "../controllers/orderController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const ordersRouter = Router();

ordersRouter.get("/share/:shareToken", getSharedPickupOrder);

ordersRouter.use(requireAuth);
ordersRouter.get("/staff/attendance", getStaffAttendanceStatus);
ordersRouter.post("/staff/attendance/clock-in", clockInStaffAttendance);
ordersRouter.patch("/staff/attendance/clock-out", clockOutStaffAttendance);
ordersRouter.get("/staff/dashboard", getStaffDashboard);
ordersRouter.get("/staff/pickups", getStaffPickupSchedule);
ordersRouter.get("/staff/verification/:orderId", getStaffVerificationOrder);
ordersRouter.patch("/staff/pickups/capacity", updateStaffPickupCapacity);
ordersRouter.patch("/staff/verification/:orderId", updateStaffVerificationOrder);
ordersRouter.get("/drafts/latest", getLatestCustomerDraft);
ordersRouter.get("/drafts/:draftId", getCustomerDraftById);
ordersRouter.post("/drafts", createDraft);
ordersRouter.patch("/drafts/:draftId", updateDraft);
ordersRouter.delete("/drafts/:draftId", deleteDraft);
ordersRouter.get("/", getCustomerOrders);
ordersRouter.post("/:orderId/share", createCustomerOrderShareLink);
ordersRouter.get("/:orderId", getCustomerOrderById);
ordersRouter.post("/", createOrder);
ordersRouter.patch("/:orderId", updateCustomerOrder);
ordersRouter.patch("/:orderId/cancel", cancelCustomerOrder);

export default ordersRouter;
