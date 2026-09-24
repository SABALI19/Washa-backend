import { Router } from "express";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notificationController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const notificationRouter = Router();

notificationRouter.use(requireAuth);
notificationRouter.get("/", getNotifications);
notificationRouter.patch("/read-all", markAllNotificationsRead);
notificationRouter.patch("/:notificationId/read", markNotificationRead);

export default notificationRouter;
