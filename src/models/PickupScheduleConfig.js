import mongoose from "mongoose";

const pickupSlotConfigSchema = new mongoose.Schema(
  {
    capacity: {
      min: 0,
      type: Number,
      required: true,
    },
    id: {
      enum: ["morning", "afternoon", "evening"],
      required: true,
      type: String,
    },
    isBlocked: {
      default: false,
      type: Boolean,
    },
  },
  {
    _id: false,
  },
);

const pickupScheduleConfigSchema = new mongoose.Schema(
  {
    dateKey: {
      index: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    slots: {
      default: [],
      type: [pickupSlotConfigSchema],
    },
    specialHoursEnabled: {
      default: false,
      type: Boolean,
    },
    updatedBy: {
      default: null,
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    timestamps: true,
  },
);

const PickupScheduleConfig =
  mongoose.models.PickupScheduleConfig ||
  mongoose.model("PickupScheduleConfig", pickupScheduleConfigSchema);

export default PickupScheduleConfig;
