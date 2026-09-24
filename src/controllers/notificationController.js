import Notification from "../models/Notification.js";

const serializeNotification = (notification) => ({
  id: notification._id,
  actor: notification.actor,
  createdAt: notification.createdAt,
  message: notification.message,
  metadata: notification.metadata || {},
  order: notification.order
    ? {
        id: notification.order._id,
        orderNumber: notification.order.orderNumber,
        status: notification.order.status,
      }
    : null,
  readAt: notification.readAt,
  title: notification.title,
  type: notification.type,
});

export const getNotifications = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("order", "orderNumber status")
      .populate("actor", "name role");
    const unreadCount = await Notification.countDocuments({
      readAt: null,
      recipient: req.user._id,
    });

    return res.status(200).json({
      notifications: notifications.map(serializeNotification),
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to load notifications.",
    });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      recipient: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found." });
    }

    notification.readAt = notification.readAt || new Date();
    await notification.save();

    return res.status(200).json({
      notification: serializeNotification(notification),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Notification not found." });
    }

    return res.status(500).json({
      message: error.message || "Unable to update notification.",
    });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        readAt: null,
        recipient: req.user._id,
      },
      {
        $set: { readAt: new Date() },
      },
    );

    return res.status(200).json({ message: "Notifications marked as read." });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to update notifications.",
    });
  }
};
