import Order from "../models/Order.js";
import StaffAttendance from "../models/StaffAttendance.js";
import User from "../models/User.js";

const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "in-progress"]);
const DISPUTE_ITEM_STATUSES = new Set(["flagged", "missing"]);
const DISPUTE_ACTIVE_STATUSES = new Set(["Open", "In Review"]);
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HOUR_IN_MS = 60 * 60 * 1000;
const DEFAULT_ANALYTICS_DAYS = 7;
const ANALYTICS_RANGE_DAYS = {
  custom: 7,
  day: 1,
  month: 30,
  quarter: 90,
  today: 1,
  week: 7,
  year: 365,
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    style: "currency",
  }).format(Number(value) || 0);

const formatNumber = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);

const formatPercent = (value, digits = 0) => `${Number(value || 0).toFixed(digits)}%`;

const toRoundedNumberString = (value, digits = 1) => Number(value || 0).toFixed(digits);

const toTitleCase = (value) =>
  String(value || "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const getStartOfDay = (value = new Date()) => {
  const nextDate = new Date(value);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

const getEndOfDay = (value = new Date()) => {
  const nextDate = new Date(value);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
};

const addDays = (value, days) => new Date(new Date(value).getTime() + days * DAY_IN_MS);

const getAnalyticsRangeDays = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();

  return ANALYTICS_RANGE_DAYS[normalizedValue] || DEFAULT_ANALYTICS_DAYS;
};

const isWithinRange = (value, start, end) => {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  return timestamp >= start.getTime() && timestamp <= end.getTime();
};

const calculatePercentChange = (current, previous) => {
  if (!previous) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / previous) * 100;
};

const formatSignedPercentChange = (current, previous) => {
  const percentChange = calculatePercentChange(current, previous);
  const roundedPercent = Math.round(percentChange);
  const signPrefix = roundedPercent > 0 ? "+" : "";
  return `${signPrefix}${roundedPercent}%`;
};

const formatRelativeTime = (value) => {
  if (!value) {
    return "Recently";
  }

  const elapsedMs = Date.now() - new Date(value).getTime();
  const elapsedMinutes = Math.max(Math.round(elapsedMs / (60 * 1000)), 1);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }

  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
};

const formatDateTime = (value) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

const getOrderItemCount = (order) =>
  (order.items || []).reduce((sum, item) => sum + Math.max(Number(item.quantity) || 0, 1), 0);

const getOrdersInDateRange = (orders, start, end) =>
  orders.filter((order) => isWithinRange(order.createdAt, start, end));

const getRevenueForOrders = (orders) =>
  orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);

const getDateBuckets = (days, endDate = new Date()) => {
  const buckets = [];
  const startDate = getStartOfDay(addDays(endDate, -(days - 1)));

  for (let index = 0; index < days; index += 1) {
    const bucketStart = addDays(startDate, index);
    const bucketEnd = getEndOfDay(bucketStart);

    buckets.push({
      end: bucketEnd,
      key: bucketStart.toISOString().split("T")[0],
      label: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(bucketStart),
      start: bucketStart,
    });
  }

  return buckets;
};

const getPeakHourBuckets = () => [
  { fromHour: 6, label: "6-9 AM", toHour: 9 },
  { fromHour: 9, label: "9-12 PM", toHour: 12 },
  { fromHour: 12, label: "12-3 PM", toHour: 15 },
  { fromHour: 15, label: "3-6 PM", toHour: 18 },
  { fromHour: 18, label: "6-9 PM", toHour: 21 },
];

const getPickupSlotDefinitions = () => [
  { id: "morning", label: "Morning", fromHour: 9, toHour: 12 },
  { id: "afternoon", label: "Afternoon", fromHour: 12, toHour: 16 },
  { id: "evening", label: "Evening", fromHour: 16, toHour: 20 },
];

const getPickupSlotId = (scheduledFor) => {
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;

  if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
    return "";
  }

  const hour = scheduledDate.getHours();
  return (
    getPickupSlotDefinitions().find((definition) => hour >= definition.fromHour && hour < definition.toHour)
      ?.id || ""
  );
};

const getProcessingStageRows = (orders) => {
  const statusCounts = {
    cancelled: 0,
    completed: 0,
    confirmed: 0,
    "in-progress": 0,
    pending: 0,
  };

  orders.forEach((order) => {
    if (statusCounts[order.status] !== undefined) {
      statusCounts[order.status] += 1;
    }
  });

  return [
    { label: "Pending", value: statusCounts.pending },
    { label: "Confirmed", value: statusCounts.confirmed },
    { label: "In Progress", value: statusCounts["in-progress"] },
    { label: "Completed", value: statusCounts.completed },
    { label: "Cancelled", value: statusCounts.cancelled },
  ];
};

const getIssueTypeLabel = (itemVerification) => {
  if (itemVerification.status === "missing") {
    return "Missing Item";
  }

  if (itemVerification.issueType) {
    return itemVerification.issueType;
  }

  return "Quality Issue";
};

const getDisputePriority = (itemVerification) => {
  if (itemVerification.status === "missing") {
    return "High Priority";
  }

  if (itemVerification.severity === "critical" || itemVerification.severity === "high") {
    return "High Priority";
  }

  if (itemVerification.severity === "medium") {
    return "Medium Priority";
  }

  return "Low Priority";
};

const getDisputeStatus = (order) => {
  if (order.status === "completed") {
    return "Resolved";
  }

  if (order.verification?.status === "completed") {
    return "In Review";
  }

  return "Open";
};

const getDisputeDescription = (order, item, itemVerification, itemIndex) => {
  if (itemVerification.notes) {
    return itemVerification.notes;
  }

  return `Issue reported for ${item.itemName || `item ${itemIndex + 1}`} in order ${order.orderNumber}.`;
};

const buildDisputeRecords = (orders) => {
  const disputes = [];

  orders.forEach((order) => {
    (order.items || []).forEach((item, itemIndex) => {
      const itemVerification = item.verification || {};
      const hasDispute =
        DISPUTE_ITEM_STATUSES.has(itemVerification.status) ||
        Boolean(itemVerification.issueType) ||
        Boolean(itemVerification.notes);

      if (!hasDispute) {
        return;
      }

      const createdAt =
        itemVerification.updatedAt ||
        itemVerification.verifiedAt ||
        order.verification?.updatedAt ||
        order.updatedAt ||
        order.createdAt;
      const updatedByName = order.verification?.updatedBy?.name || "Operations Team";

      disputes.push({
        assignedTo: updatedByName,
        createdAt,
        createdAtLabel: formatDateTime(createdAt),
        customer: order.customer?.name || "Customer",
        description: getDisputeDescription(order, item, itemVerification, itemIndex),
        id: `DIS-${order.orderNumber}-${itemIndex + 1}`,
        orderId: order.orderNumber,
        priority: getDisputePriority(itemVerification),
        status: getDisputeStatus(order),
        type: getIssueTypeLabel(itemVerification),
        updatedAt: formatRelativeTime(createdAt),
      });
    });
  });

  return disputes.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
};

const buildRecentActivity = (orders, disputes) => {
  const orderActivities = orders.slice(0, 4).map((order) => {
    let text = `Order #${order.orderNumber} updated`;
    let type = "order-update";

    if (order.status === "completed") {
      text = `Order #${order.orderNumber} completed and ready for pickup`;
      type = "order-completed";
    } else if (order.status === "in-progress") {
      text = `Order #${order.orderNumber} is now in processing`;
      type = "processing";
    } else if (order.status === "pending") {
      text = `New order #${order.orderNumber} submitted by ${order.customer?.name || "a customer"}`;
      type = "order-created";
    }

    return {
      id: `activity-order-${order.orderNumber}`,
      text,
      time: formatRelativeTime(order.updatedAt || order.createdAt),
      timestamp: new Date(order.updatedAt || order.createdAt).getTime(),
      type,
    };
  });

  const disputeActivities = disputes.slice(0, 3).map((dispute) => ({
    id: `activity-dispute-${dispute.id}`,
    text: `Dispute reported for order #${dispute.orderId}`,
    time: formatRelativeTime(dispute.createdAt),
    timestamp: new Date(dispute.createdAt).getTime(),
    type: "dispute",
  }));

  return [...orderActivities, ...disputeActivities]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 5)
    .map(({ timestamp, ...activity }) => activity);
};

const buildOrderStatusBreakdown = (orders) => {
  const labels = [
    { color: "#157f85", label: "Pending Verification", status: "pending" },
    { color: "#1f9fa6", label: "Confirmed", status: "confirmed" },
    { color: "#8dad8f", label: "Ready for Pickup", status: "completed" },
    { color: "#6e8aa1", label: "In Progress", status: "in-progress" },
    { color: "#7ea0b0", label: "Cancelled", status: "cancelled" },
  ];
  const totalOrders = Math.max(orders.length, 1);

  return labels.map((item) => {
    const count = orders.filter((order) => order.status === item.status).length;

    return {
      color: item.color,
      label: item.label,
      value: formatPercent((count / totalOrders) * 100),
    };
  });
};

const buildOrderVolumeTrend = (orders, days = DEFAULT_ANALYTICS_DAYS) => {
  const buckets = getDateBuckets(days);
  const firstOrderDateByCustomer = new Map();

  [...orders]
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .forEach((order) => {
      const customerId = String(order.customer?._id || order.customer || "");

      if (customerId && !firstOrderDateByCustomer.has(customerId)) {
        firstOrderDateByCustomer.set(customerId, new Date(order.createdAt).toISOString().split("T")[0]);
      }
    });

  const totalOrders = [];
  const newCustomers = [];
  const returning = [];

  buckets.forEach((bucket) => {
    const bucketOrders = orders.filter((order) => isWithinRange(order.createdAt, bucket.start, bucket.end));
    const totalCount = bucketOrders.length;
    const newCustomerCount = bucketOrders.filter((order) => {
      const customerId = String(order.customer?._id || order.customer || "");
      return customerId && firstOrderDateByCustomer.get(customerId) === bucket.key;
    }).length;

    totalOrders.push(totalCount);
    newCustomers.push(newCustomerCount);
    returning.push(Math.max(totalCount - newCustomerCount, 0));
  });

  return {
    labels: buckets.map((bucket) => bucket.label),
    newCustomers,
    returning,
    totalOrders,
  };
};

const buildPeakHours = (orders) => {
  const peakHourBuckets = getPeakHourBuckets();

  return peakHourBuckets.map((bucket) => ({
    label: bucket.label,
    value: orders.filter((order) => {
      const sourceDate = order.scheduledFor || order.createdAt;
      const hour = new Date(sourceDate).getHours();
      return hour >= bucket.fromHour && hour < bucket.toHour;
    }).length,
  }));
};

const buildPickupUtilization = (orders) => {
  const slotDefinitions = getPickupSlotDefinitions();
  const scheduledOrders = orders.filter((order) => order.scheduledFor);
  const slotCounts = slotDefinitions.map((definition) => ({
    label: definition.label,
    rawCount: scheduledOrders.filter((order) => getPickupSlotId(order.scheduledFor) === definition.id).length,
  }));
  const maxCount = Math.max(...slotCounts.map((slot) => slot.rawCount), 1);
  const overdueCount = scheduledOrders.filter(
    (order) =>
      order.scheduledFor &&
      new Date(order.scheduledFor).getTime() < Date.now() &&
      ACTIVE_ORDER_STATUSES.has(order.status),
  ).length;
  const unscheduledCount = orders.filter((order) => !order.scheduledFor).length;

  return {
    slots: slotCounts.map((slot) => ({
      label: slot.label,
      value: Math.round((slot.rawCount / maxCount) * 100),
    })),
    summaryItems: [
      { label: "Overdue Share", value: formatPercent((overdueCount / Math.max(scheduledOrders.length, 1)) * 100, 1) },
      { label: "Unscheduled Orders", value: formatNumber(unscheduledCount) },
    ],
  };
};

const buildQualityMetrics = (orders, disputes) => {
  const totalOrders = Math.max(orders.length, 1);
  const completedOrders = orders.filter((order) => order.status === "completed").length;
  const verifiedOrders = orders.filter((order) => order.verification?.status === "completed").length;
  const disputedOrderIds = new Set(disputes.map((dispute) => dispute.orderId));
  const issueFreeOrders = Math.max(totalOrders - disputedOrderIds.size, 0);
  const completionBuckets = getDateBuckets(DEFAULT_ANALYTICS_DAYS);
  const serviceCounts = new Map();

  orders.forEach((order) => {
    const tokens = new Set([
      toTitleCase(order.serviceType),
      ...(order.items || []).map((item) => toTitleCase(item.service || item.itemName)),
    ]);

    tokens.forEach((token) => {
      if (!token) {
        return;
      }

      serviceCounts.set(token, (serviceCounts.get(token) || 0) + 1);
    });
  });

  const feedbackWords = Array.from(serviceCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([text], index) => ({
      size:
        index === 0 || index === 1
          ? "text-[1.5rem]"
          : index <= 3
            ? "text-[1rem]"
            : "text-[0.78rem]",
      text,
    }));

  return {
    distribution: completionBuckets.map((bucket) =>
      orders.filter(
        (order) => order.status === "completed" && isWithinRange(order.updatedAt || order.createdAt, bucket.start, bucket.end),
      ).length,
    ),
    distributionLabel: "Daily Completions",
    distributionLabels: completionBuckets.map((bucket) => bucket.label),
    feedbackWords,
    metricBlocks: [
      {
        label: "Issue-Free Orders",
        tone: "primary",
        value: formatPercent((issueFreeOrders / totalOrders) * 100),
      },
      {
        label: "Verified Orders",
        tone: "primary",
        value: formatPercent((verifiedOrders / totalOrders) * 100),
      },
      {
        label: "Dispute Rate",
        tone: "danger",
        value: formatPercent((disputedOrderIds.size / totalOrders) * 100, 1),
      },
    ],
    wordCloudLabel: "Most Requested Services",
  };
};

const buildFinancialPerformance = (orders, customers) => {
  const buckets = Array.from({ length: 4 }, (_, index) => {
    const weekOffset = 3 - index;
    const start = getStartOfDay(addDays(new Date(), -(weekOffset * 7 + 6)));
    const end = getEndOfDay(addDays(start, 6));

    return {
      end,
      label: `Week ${index + 1}`,
      start,
    };
  });
  const revenuePoints = buckets.map((bucket) => ({
    label: bucket.label,
    value: getRevenueForOrders(orders.filter((order) => isWithinRange(order.createdAt, bucket.start, bucket.end))),
  }));
  const totalRevenue = revenuePoints.reduce((sum, point) => sum + point.value, 0);
  const previousRevenue = revenuePoints.slice(0, -1).reduce((sum, point) => sum + point.value, 0);
  const averageOrderValue = totalRevenue / Math.max(orders.length, 1);
  const revenuePerCustomer = totalRevenue / Math.max(customers.length, 1);

  return {
    dataPoints: revenuePoints,
    growthRate: formatSignedPercentChange(revenuePoints[revenuePoints.length - 1]?.value || 0, previousRevenue / 3 || 0),
    metrics: [
      { label: "Average Order Value", value: formatCurrency(averageOrderValue) },
      { label: "Revenue per Customer", value: formatCurrency(revenuePerCustomer) },
      { label: "Growth Rate", tone: "positive", value: formatSignedPercentChange(totalRevenue, previousRevenue) },
    ],
  };
};

const buildStaffMetrics = async (orders) => {
  const staffUsers = await User.find({ role: { $in: ["staff", "admin"] } })
    .sort({ createdAt: 1 })
    .select("name role");
  const handledCountByUserId = new Map();

  orders.forEach((order) => {
    const updatedById = String(order.verification?.updatedBy?._id || order.verification?.updatedBy || "");

    if (!updatedById) {
      return;
    }

    handledCountByUserId.set(updatedById, (handledCountByUserId.get(updatedById) || 0) + 1);
  });

  const totalHandledOrders = Math.max(Array.from(handledCountByUserId.values()).reduce((sum, value) => sum + value, 0), 1);

  return {
    primaryColumnLabel: "Staff",
    secondaryColumnLabel: "Orders",
    tertiaryColumnLabel: "Share",
    rows: staffUsers.map((staffUser) => {
      const handledOrders = handledCountByUserId.get(String(staffUser._id)) || 0;

      return {
        metric: formatPercent((handledOrders / totalHandledOrders) * 100),
        name: `${staffUser.name}${staffUser.role === "admin" ? " (Admin)" : ""}`,
        orders: handledOrders,
      };
    }),
  };
};

const buildDisputeSummary = (disputes) => {
  const resolvedDisputes = disputes.filter((dispute) => dispute.status === "Resolved");
  const averageResolutionDays =
    resolvedDisputes.reduce((sum, dispute) => {
      const disputeAgeMs = Date.now() - new Date(dispute.createdAt).getTime();
      return sum + disputeAgeMs / DAY_IN_MS;
    }, 0) / Math.max(resolvedDisputes.length, 1);
  const disputesByType = disputes.reduce((map, dispute) => {
    const entries = map.get(dispute.type) || { resolved: 0, total: 0 };

    entries.total += 1;

    if (dispute.status === "Resolved") {
      entries.resolved += 1;
    }

    map.set(dispute.type, entries);
    return map;
  }, new Map());
  const commonReasons = Array.from(disputesByType.entries()).map(([label, value]) => ({
    label,
    value: value.total,
  }));

  return {
    averageResolutionDays: toRoundedNumberString(averageResolutionDays || 0, 1),
    averageResolutionDelta: `${averageResolutionDays > 0 ? "-" : ""}${toRoundedNumberString(Math.max(averageResolutionDays / 5, 0.1), 1)} days`,
    commonReasons,
    resolutionRates: Array.from(disputesByType.entries()).map(([label, value]) => ({
      label,
      value: formatPercent((value.resolved / Math.max(value.total, 1)) * 100),
    })),
  };
};

const requireAdminRole = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "Only admin users can access admin dashboards." });
    return false;
  }

  return true;
};

const loadOrdersForAdmin = async () =>
  Order.find({})
    .sort({ updatedAt: -1 })
    .populate("customer", "name email phone")
    .populate("verification.updatedBy", "name role");

export const getAdminDashboard = async (req, res) => {
  try {
    if (!requireAdminRole(req, res)) {
      return undefined;
    }

    const [orders, staffOnDutyCount] = await Promise.all([
      loadOrdersForAdmin(),
      StaffAttendance.countDocuments({
        clockedOutAt: null,
        status: "active",
      }),
    ]);
    const now = new Date();
    const rangeDays = getAnalyticsRangeDays(req.query.range);
    const rangeEnd = getEndOfDay(now);
    const rangeStart = getStartOfDay(addDays(now, -(rangeDays - 1)));
    const previousRangeStart = getStartOfDay(addDays(rangeStart, -rangeDays));
    const previousRangeEnd = getEndOfDay(addDays(rangeEnd, -rangeDays));
    const rangeOrders = getOrdersInDateRange(orders, rangeStart, rangeEnd);
    const previousRangeOrders = getOrdersInDateRange(orders, previousRangeStart, previousRangeEnd);
    const disputes = buildDisputeRecords(rangeOrders);
    const allDisputes = buildDisputeRecords(orders);
    const rangeRevenue = getRevenueForOrders(rangeOrders);
    const previousRangeRevenue = getRevenueForOrders(previousRangeOrders);
    const activeOrders = rangeOrders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));
    const activeOrdersPreviousRange = previousRangeOrders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));
    const overdueOrders = orders.filter(
      (order) =>
        order.scheduledFor &&
        new Date(order.scheduledFor).getTime() < Date.now() &&
        ACTIVE_ORDER_STATUSES.has(order.status),
    );
    const issueFreeOrders = Math.max(
      rangeOrders.filter((order) => order.status === "completed").length -
        disputes.filter((dispute) => dispute.status !== "Resolved").length,
      0,
    );
    const completedOrders = Math.max(rangeOrders.filter((order) => order.status === "completed").length, 1);
    const peakHours = buildPeakHours(rangeOrders);

    return res.status(200).json({
      dashboard: {
        activeRange: String(req.query.range || "today"),
        alerts: [
          {
            id: "overdue",
            text: `${formatNumber(overdueOrders.length)} orders past pickup time`,
            title: "Overdue Orders",
            tone: "danger",
          },
          {
            id: "disputes",
            text: `${formatNumber(allDisputes.filter((dispute) => DISPUTE_ACTIVE_STATUSES.has(dispute.status)).length)} disputes need review`,
            title: "Pending Disputes",
            tone: "warning",
          },
          {
            id: "approvals",
            text: `${formatNumber(orders.filter((order) => order.status === "pending").length)} orders still need verification`,
            title: "Verification Queue",
            tone: "info",
          },
        ],
        businessInformation: {
          name:
            process.env.BUSINESS_NAME ||
            process.env.WASHA_BUSINESS_NAME ||
            "Clean & Fresh Laundry",
          staffOnDutyCount,
          staffOnDutyLabel: `${formatNumber(staffOnDutyCount)} staff on duty`,
          status: "Operating",
          statusLabel: "Operating",
        },
        currentOrderStatus: {
          items: buildOrderStatusBreakdown(rangeOrders),
        },
        dateRangeLabel: `${new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
        }).format(rangeStart)} - ${new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(rangeEnd)}`,
        generatedAt: now.toISOString(),
        orderVolumeTrend: {
          dataPoints: peakHours.map((item) => item.value),
          labels: peakHours.map((item) => item.label.replace("-", " - ")),
        },
        quickActions: [
          "View All Orders",
          "Dispute Management",
          "Performance Reports",
          "Staff Schedule",
        ],
        recentActivity: buildRecentActivity(rangeOrders, disputes),
        stats: [
          {
            change: formatSignedPercentChange(rangeOrders.length, previousRangeOrders.length),
            id: "orders-today",
            title: rangeDays === 1 ? "Total Orders Today" : "Total Orders",
            value: formatNumber(rangeOrders.length),
          },
          {
            change: formatSignedPercentChange(activeOrders.length, activeOrdersPreviousRange.length),
            id: "active-orders",
            title: "Active Orders",
            value: formatNumber(activeOrders.length),
          },
          {
            change: formatSignedPercentChange(rangeRevenue, previousRangeRevenue),
            id: "revenue-today",
            title: rangeDays === 1 ? "Revenue Today" : "Revenue",
            value: formatCurrency(rangeRevenue),
          },
          {
            id: "fulfillment-rate",
            subtitle: `${formatNumber(completedOrders)} completed orders`,
            title: "Fulfillment Rate",
            value: formatPercent((issueFreeOrders / completedOrders) * 100),
          },
        ],
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch the admin dashboard.",
    });
  }
};

export const getAdminStaffManagement = async (req, res) => {
  try {
    if (!requireAdminRole(req, res)) {
      return undefined;
    }

    const staffMembers = await User.find({ role: "staff" })
      .select("createdAt email name phone role updatedAt")
      .sort({ name: 1 });
    const staffIds = staffMembers.map((staff) => staff._id);
    const activeAttendanceRecords = await StaffAttendance.find({
      clockedOutAt: null,
      staff: { $in: staffIds },
      status: "active",
    }).sort({ clockedInAt: -1 });
    const activeAttendanceByStaffId = new Map(
      activeAttendanceRecords.map((attendance) => [
        attendance.staff.toString(),
        attendance,
      ]),
    );
    const staffRows = staffMembers.map((staff) => {
      const activeAttendance = activeAttendanceByStaffId.get(staff._id.toString());

      return {
        clockedInAt: activeAttendance?.clockedInAt || null,
        clockedInAtLabel: activeAttendance?.clockedInAt
          ? formatDateTime(activeAttendance.clockedInAt)
          : "Not on duty",
        email: staff.email,
        id: staff._id,
        isOnDuty: Boolean(activeAttendance),
        name: staff.name,
        phone: staff.phone,
        role: staff.role,
        status: activeAttendance ? "On Duty" : "Off Duty",
      };
    });

    return res.status(200).json({
      staffManagement: {
        generatedAt: new Date().toISOString(),
        rows: staffRows,
        summary: {
          offDutyCount: staffRows.filter((staff) => !staff.isOnDuty).length,
          onDutyCount: staffRows.filter((staff) => staff.isOnDuty).length,
          totalStaff: staffRows.length,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch staff management.",
    });
  }
};

export const getAdminAnalytics = async (req, res) => {
  try {
    if (!requireAdminRole(req, res)) {
      return undefined;
    }

    const [orders, customers] = await Promise.all([
      loadOrdersForAdmin(),
      User.find({ role: "customer" }).select("createdAt"),
    ]);
    const now = new Date();
    const rangeDays = getAnalyticsRangeDays(req.query.range);
    const rangeEnd = getEndOfDay(now);
    const rangeStart = getStartOfDay(addDays(now, -(rangeDays - 1)));
    const previousRangeStart = getStartOfDay(addDays(rangeStart, -rangeDays));
    const previousRangeEnd = getEndOfDay(addDays(rangeEnd, -rangeDays));
    const rangeOrders = getOrdersInDateRange(orders, rangeStart, rangeEnd);
    const previousRangeOrders = getOrdersInDateRange(orders, previousRangeStart, previousRangeEnd);
    const rangeDisputes = buildDisputeRecords(rangeOrders);
    const orderVolumeTrends = buildOrderVolumeTrend(orders, rangeDays);
    const completedRangeOrders = rangeOrders.filter((order) => order.status === "completed");
    const averageCompletionHours =
      completedRangeOrders.reduce((sum, order) => {
        const startedAt = new Date(order.createdAt).getTime();
        const completedAt = new Date(order.updatedAt || order.createdAt).getTime();
        return sum + (completedAt - startedAt) / HOUR_IN_MS;
      }, 0) / Math.max(completedRangeOrders.length, 1);
    const previousAverageCompletionHours =
      previousRangeOrders
        .filter((order) => order.status === "completed")
        .reduce((sum, order) => {
          const startedAt = new Date(order.createdAt).getTime();
          const completedAt = new Date(order.updatedAt || order.createdAt).getTime();
          return sum + (completedAt - startedAt) / HOUR_IN_MS;
        }, 0) /
      Math.max(previousRangeOrders.filter((order) => order.status === "completed").length, 1);
    const rangeRevenue = getRevenueForOrders(rangeOrders);
    const previousRevenue = getRevenueForOrders(previousRangeOrders);
    const returningOrdersCount = orderVolumeTrends.returning.reduce((sum, value) => sum + value, 0);
    const totalOrdersCount = Math.max(rangeOrders.length, 1);
    const qualityMetrics = buildQualityMetrics(rangeOrders, rangeDisputes);
    const financialPerformance = buildFinancialPerformance(rangeOrders, customers);
    const processingPerformance = getProcessingStageRows(rangeOrders);
    const processingBottleneck =
      [...processingPerformance]
        .filter((item) => !["Completed", "Cancelled"].includes(item.label))
        .sort((left, right) => right.value - left.value)[0]?.label || "Pending";

    return res.status(200).json({
      analytics: {
        customerExperience: qualityMetrics,
        dateRangeLabel: `${new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
        }).format(rangeStart)} - ${new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(rangeEnd)}`,
        financialPerformance,
        generatedAt: now.toISOString(),
        metrics: [
          {
            change: formatSignedPercentChange(rangeOrders.length, previousRangeOrders.length),
            changeTone: "up",
            id: "orders",
            title: "Total Orders",
            value: formatNumber(rangeOrders.length),
          },
          {
            change: formatSignedPercentChange(averageCompletionHours, previousAverageCompletionHours),
            changeTone: averageCompletionHours <= previousAverageCompletionHours ? "down" : "up",
            detail: `${toRoundedNumberString(previousAverageCompletionHours || 0, 1)}h previous period`,
            id: "processing",
            title: "Avg Completion Time",
            value: `${toRoundedNumberString(averageCompletionHours || 0, 1)}h`,
          },
          {
            change: formatSignedPercentChange(returningOrdersCount, previousRangeOrders.length),
            changeTone: "up",
            detail: `${formatPercent((returningOrdersCount / totalOrdersCount) * 100)} of orders in range`,
            id: "returning",
            title: "Returning Orders",
            value: formatNumber(returningOrdersCount),
          },
          {
            change: formatSignedPercentChange(rangeRevenue, previousRevenue),
            changeTone: "up",
            detail: formatCurrency(rangeRevenue / totalOrdersCount),
            id: "revenue",
            title: "Total Revenue",
            value: formatCurrency(rangeRevenue),
          },
        ],
        orderVolumeTrends,
        peakHours: buildPeakHours(rangeOrders),
        pickupTimeUtilization: buildPickupUtilization(rangeOrders),
        processingPerformance: {
          bars: processingPerformance,
          bottleneck: `${processingBottleneck} queue is currently the heaviest`,
          efficiencyText: `${formatPercent((completedRangeOrders.length / totalOrdersCount) * 100)} completed in this range`,
        },
        staffMetrics: await buildStaffMetrics(rangeOrders),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch admin analytics.",
    });
  }
};

export const getAdminDisputes = async (req, res) => {
  try {
    if (!requireAdminRole(req, res)) {
      return undefined;
    }

    const orders = await loadOrdersForAdmin();
    const disputes = buildDisputeRecords(orders);
    const disputeSummary = buildDisputeSummary(disputes);

    return res.status(200).json({
      disputesDashboard: {
        activeCount: disputes.filter((dispute) => DISPUTE_ACTIVE_STATUSES.has(dispute.status)).length,
        generatedAt: new Date().toISOString(),
        statusFilters: ["All", "Open", "In Review", "Resolved", "Closed"],
        summary: disputeSummary,
        disputes: disputes.slice(0, 25),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch disputes.",
    });
  }
};
