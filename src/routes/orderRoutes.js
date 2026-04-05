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
  createOrder,
  getCustomerOrderById,
  getCustomerOrders,
  getStaffDashboard,
  updateCustomerOrder,
} from "../controllers/orderController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const ordersRouter = Router();

ordersRouter.use(requireAuth);
ordersRouter.get("/staff/dashboard", getStaffDashboard);
ordersRouter.get("/drafts/latest", getLatestCustomerDraft);
ordersRouter.get("/drafts/:draftId", getCustomerDraftById);
ordersRouter.post("/drafts", createDraft);
ordersRouter.patch("/drafts/:draftId", updateDraft);
ordersRouter.delete("/drafts/:draftId", deleteDraft);
ordersRouter.get("/", getCustomerOrders);
ordersRouter.get("/:orderId", getCustomerOrderById);
ordersRouter.post("/", createOrder);
ordersRouter.patch("/:orderId", updateCustomerOrder);
ordersRouter.patch("/:orderId/cancel", cancelCustomerOrder);

export default ordersRouter;
