import crypto from "crypto";
import mongoose from "mongoose";

const verificationChecklistSchema = new mongoose.Schema(
  {
    categoryCorrect: {
      default: false,
      type: Boolean,
    },
    colorAccurate: {
      default: false,
      type: Boolean,
    },
    conditionAsDescribed: {
      default: false,
      type: Boolean,
    },
    itemMatchesPhoto: {
      default: false,
      type: Boolean,
    },
  },
  {
    _id: false,
  },
);

const itemVerificationSchema = new mongoose.Schema(
  {
    checklist: {
      default: () => ({}),
      type: verificationChecklistSchema,
    },
    documentationImagePath: {
      default: "",
      select: false,
      trim: true,
      type: String,
    },
    documentationImageUrl: {
      default: "",
      trim: true,
      type: String,
    },
    issueType: {
      default: "",
      trim: true,
      type: String,
    },
    notes: {
      default: "",
      trim: true,
      type: String,
    },
    severity: {
      default: "",
      enum: ["", "low", "medium", "high", "critical"],
      type: String,
    },
    status: {
      default: "pending",
      enum: ["pending", "verified", "flagged", "missing"],
      type: String,
    },
    updatedAt: {
      default: null,
      type: Date,
    },
    verifiedAt: {
      default: null,
      type: Date,
    },
  },
  {
    _id: false,
  },
);

const orderVerificationSchema = new mongoose.Schema(
  {
    completedAt: {
      default: null,
      type: Date,
    },
    notifyCustomer: {
      default: true,
      type: Boolean,
    },
    orderNotes: {
      default: "",
      trim: true,
      type: String,
    },
    startedAt: {
      default: null,
      type: Date,
    },
    status: {
      default: "not-started",
      enum: ["not-started", "in-progress", "completed"],
      type: String,
    },
    updatedAt: {
      default: null,
      type: Date,
    },
    updatedBy: {
      default: null,
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    _id: false,
  },
);

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
    verification: {
      default: () => ({}),
      type: itemVerificationSchema,
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
    verification: {
      default: () => ({}),
      type: orderVerificationSchema,
    },
  },
  {
    timestamps: true,
  },
);

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
