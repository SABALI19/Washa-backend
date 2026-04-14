import mongoose from "mongoose";

const staffAttendanceSchema = new mongoose.Schema(
  {
    clockedInAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    clockedOutAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    source: {
      type: String,
      enum: ["dashboard", "manual"],
      default: "dashboard",
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

staffAttendanceSchema.index(
  { staff: 1, status: 1 },
  {
    partialFilterExpression: { status: "active" },
    unique: true,
  },
);

const StaffAttendance =
  mongoose.models.StaffAttendance ||
  mongoose.model("StaffAttendance", staffAttendanceSchema);

export default StaffAttendance;
