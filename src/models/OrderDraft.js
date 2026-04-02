import mongoose from "mongoose";
import { orderItemSchema } from "./Order.js";

const orderDraftSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    serviceType: {
      type: String,
      trim: true,
      default: "",
    },
    pickupAddress: {
      type: String,
      trim: true,
      default: "",
    },
    deliveryAddress: {
      type: String,
      trim: true,
      default: "",
    },
    pickupWindow: {
      type: String,
      trim: true,
      default: "",
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
    currentStep: {
      type: Number,
      min: 1,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

const OrderDraft =
  mongoose.models.OrderDraft || mongoose.model("OrderDraft", orderDraftSchema);

export default OrderDraft;
