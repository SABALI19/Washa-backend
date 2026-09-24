import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    actor: {
      default: null,
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    message: {
      required: true,
      trim: true,
      type: String,
    },
    metadata: {
      default: {},
      type: mongoose.Schema.Types.Mixed,
    },
    order: {
      default: null,
      ref: "Order",
      type: mongoose.Schema.Types.ObjectId,
    },
    readAt: {
      default: null,
      type: Date,
    },
    recipient: {
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    title: {
      required: true,
      trim: true,
      type: String,
    },
    type: {
      default: "system",
      enum: [
        "account-created",
        "delivery-delivered",
        "delivery-picked-up",
        "delivery-sent",
        "item-verified",
        "laundry-stage",
        "order-created",
        "system",
      ],
      index: true,
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
