import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { sendNotificationEmail } from "./mailer.js";

const normalizeObjectIdString = (value) => String(value || "").trim();

const buildNotificationPayload = (payload = {}, recipientId) => ({
  actor: payload.actor || null,
  message: String(payload.message || "").trim(),
  metadata: payload.metadata || {},
  order: payload.order || null,
  recipient: recipientId,
  title: String(payload.title || "").trim(),
  type: payload.type || "system",
});

export const createNotificationForUser = async (recipientId, payload = {}) => {
  const normalizedRecipientId = normalizeObjectIdString(recipientId);
  const title = String(payload.title || "").trim();
  const message = String(payload.message || "").trim();

  if (!normalizedRecipientId || !title || !message) {
    return null;
  }

  const notification = await Notification.create(
    buildNotificationPayload(payload, normalizedRecipientId),
  );
  const recipient = await User.findById(normalizedRecipientId).select("email");

  if (recipient?.email && payload.sendEmail !== false) {
    await sendNotificationEmail({
      message,
      subject: payload.emailSubject || title,
      title,
      to: recipient.email,
    });
  }

  return notification;
};

export const createNotificationsForRoles = async (
  roles = [],
  payload = {},
  options = {},
) => {
  const normalizedRoles = [...new Set(roles.filter(Boolean))];

  if (normalizedRoles.length === 0) {
    return [];
  }

  const excludedUserIds = new Set(
    (options.excludeUserIds || []).map((id) => normalizeObjectIdString(id)),
  );
  const recipients = await User.find({
    _id: { $nin: [...excludedUserIds] },
    role: { $in: normalizedRoles },
  }).select("_id email");

  if (recipients.length === 0) {
    return [];
  }

  const notifications = await Notification.insertMany(
    recipients.map((recipient) =>
      buildNotificationPayload(payload, recipient._id),
    ),
  );

  if (payload.sendEmail !== false) {
    await Promise.all(
      recipients
        .filter((recipient) => recipient.email)
        .map((recipient) =>
          sendNotificationEmail({
            message: String(payload.message || "").trim(),
            subject: payload.emailSubject || String(payload.title || "").trim(),
            title: String(payload.title || "").trim(),
            to: recipient.email,
          }),
        ),
    );
  }

  return notifications;
};
