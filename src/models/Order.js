import crypto from "crypto";
import mongoose from "mongoose";

export const orderItemSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      trim: true,
      default: "",
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    service: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    imagePath: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },
  },
  {
    _id: false,
  },
);

const createOrderNumber = () =>
  `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      default: createOrderNumber,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    serviceType: {
      type: String,
      required: true,
      trim: true,
    },
    pickupAddress: {
      type: String,
      required: true,
      trim: true,
    },
    deliveryAddress: {
      type: String,
      required: true,
      trim: true,
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    items: {
      type: [orderItemSchema],
      default: [],
    },
    totalAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "in-progress", "completed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "refunded"],
      default: "unpaid",
    },
  },
  {
    timestamps: true,
  },
);

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
