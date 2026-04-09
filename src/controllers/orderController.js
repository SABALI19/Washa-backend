import crypto from "crypto";
import Order from "../models/Order.js";
import PickupScheduleConfig from "../models/PickupScheduleConfig.js";
import { saveImageDataUrl } from "../utils/imageStorage.js";
import {
  calculateTotalAmount,
  normalizeDate,
  normalizeItems,
  normalizeText,
  validateNormalizedItems,
} from "../utils/orderPayload.js";

const CUSTOMER_ORDER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);
const STAFF_ELIGIBLE_ROLES = new Set(["staff", "admin"]);
const VERIFICATION_ITEM_STATUSES = new Set(["pending", "verified", "flagged", "missing"]);
const VERIFICATION_ORDER_STATUSES = new Set(["not-started", "in-progress", "completed"]);
const PICKUP_WINDOW_LABELS = [
  {
    fromHour: 9,
    label: "Morning (9:00 AM - 12:00 PM)",
    toHour: 12,
  },
  {
    fromHour: 12,
    label: "Afternoon (12:00 PM - 6:00 PM)",
    toHour: 18,
  },
  {
    fromHour: 18,
    label: "Evening (6:00 PM - 8:00 PM)",
    toHour: 20,
  },
];
const PICKUP_SECTION_DEFINITIONS = [
  {
    endHour: 12,
    fillText: "Morning capacity",
    id: "morning",
    startHour: 9,
    title: "Morning Slot (9:00 AM - 12:00 PM)",
  },
  {
    endHour: 16,
    fillText: "Afternoon capacity",
    id: "afternoon",
    startHour: 12,
    title: "Afternoon Slot (12:00 PM - 4:00 PM)",
  },
  {
    endHour: 19,
    fillText: "Evening capacity",
    id: "evening",
    startHour: 16,
    title: "Evening Slot (4:00 PM - 7:00 PM)",
  },
];
const DEFAULT_PICKUP_CAPACITY_BY_SECTION = {
  afternoon: 10,
  evening: 6,
  morning: 8,
};
const VERIFICATION_ISSUE_TYPE_OPTIONS = [
  "Item mismatch",
  "Condition issue",
  "Color discrepancy",
  "Missing accessory",
  "Damage detected",
  "Other",
];
const VERIFICATION_SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];

const serializeCustomer = (customer) => {
  if (!customer) {
    return null;
  }

  if (typeof customer === "object" && customer._id) {
    return {
      id: customer._id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    };
  }

  return { id: customer };
};

const serializeOrder = (order) => ({
  id: order._id,
  orderNumber: order.orderNumber,
  customer: serializeCustomer(order.customer),
  serviceType: order.serviceType,
  pickupAddress: order.pickupAddress,
  deliveryAddress: order.deliveryAddress,
  scheduledFor: order.scheduledFor,
  notes: order.notes,
  items: order.items,
  totalAmount: order.totalAmount,
  status: order.status,
  paymentStatus: order.paymentStatus,
  pickupShare: {
    createdAt: order.pickupShare?.createdAt || null,
    hasActiveLink: Boolean(order.pickupShare?.token),
  },
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const serializeSharedPickupOrder = (order) => ({
  id: order._id,
  orderNumber: order.orderNumber,
  customer: order.customer
    ? {
        name: order.customer.name,
      }
    : null,
  serviceType: order.serviceType,
  pickupAddress: order.pickupAddress,
  deliveryAddress: order.deliveryAddress,
  scheduledFor: order.scheduledFor,
  notes: order.notes,
  items: order.items,
  totalAmount: order.totalAmount,
  status: order.status,
  paymentStatus: order.paymentStatus,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const serializeStaffDashboardOrder = (order) => ({
  customer: serializeCustomer(order.customer),
  id: order._id,
  imageUrls: (order.items || []).map((item) => item.imageUrl).filter(Boolean),
  itemCount: (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
  orderNumber: order.orderNumber,
  paymentStatus: order.paymentStatus,
  scheduledFor: order.scheduledFor,
  serviceType: order.serviceType,
  status: order.status,
  totalAmount: order.totalAmount,
  updatedAt: order.updatedAt,
  createdAt: order.createdAt,
});

const buildEmptyVerificationChecklist = () => ({
  categoryCorrect: false,
  colorAccurate: false,
  conditionAsDescribed: false,
  itemMatchesPhoto: false,
});

const serializeVerificationChecklist = (checklist = {}) => ({
  categoryCorrect: Boolean(checklist.categoryCorrect),
  colorAccurate: Boolean(checklist.colorAccurate),
  conditionAsDescribed: Boolean(checklist.conditionAsDescribed),
  itemMatchesPhoto: Boolean(checklist.itemMatchesPhoto),
});

const getNormalizedVerificationItemStatus = (value) => {
  const normalizedValue = normalizeText(value).toLowerCase();
  return VERIFICATION_ITEM_STATUSES.has(normalizedValue) ? normalizedValue : "pending";
};

const getNormalizedVerificationOrderStatus = (value) => {
  const normalizedValue = normalizeText(value).toLowerCase();
  return VERIFICATION_ORDER_STATUSES.has(normalizedValue) ? normalizedValue : "not-started";
};

const getItemVerificationState = (item = {}) => ({
  checklist: serializeVerificationChecklist(item.verification?.checklist),
  documentationImageUrl: normalizeText(item.verification?.documentationImageUrl),
  issueType: normalizeText(item.verification?.issueType),
  notes: normalizeText(item.verification?.notes),
  severity: normalizeText(item.verification?.severity).toLowerCase(),
  status: getNormalizedVerificationItemStatus(item.verification?.status),
  updatedAt: item.verification?.updatedAt || null,
  verifiedAt: item.verification?.verifiedAt || null,
});

const getVerificationStats = (items = []) =>
  items.reduce(
    (stats, item) => {
      const quantity = Math.max(Number(item.quantity) || 0, 1);
      const verificationStatus = getItemVerificationState(item).status;

      stats.totalItems += quantity;

      if (verificationStatus === "verified") {
        stats.verifiedItems += quantity;
      } else if (verificationStatus === "flagged") {
        stats.flaggedItems += quantity;
      } else if (verificationStatus === "missing") {
        stats.missingItems += quantity;
      } else {
        stats.pendingItems += quantity;
      }

      return stats;
    },
    {
      flaggedItems: 0,
      missingItems: 0,
      pendingItems: 0,
      totalItems: 0,
      verifiedItems: 0,
    },
  );

const hasVerificationProgress = (order) => {
  const orderVerification = order.verification || {};
  const normalizedOrderNotes = normalizeText(orderVerification.orderNotes);

  if (normalizedOrderNotes) {
    return true;
  }

  return (order.items || []).some((item) => {
    const verificationState = getItemVerificationState(item);
    return (
      verificationState.status !== "pending" ||
      verificationState.issueType ||
      verificationState.notes ||
      verificationState.severity ||
      verificationState.documentationImageUrl ||
      Object.values(verificationState.checklist).some(Boolean)
    );
  });
};

const serializeVerificationOrder = (order) => {
  const verificationStats = getVerificationStats(order.items || []);
  const verificationState = order.verification || {};
  const verificationStatus = getNormalizedVerificationOrderStatus(verificationState.status);

  return {
    customer: {
      ...serializeCustomer(order.customer),
      contactHref: order.customer?.phone ? `tel:${formatPhoneLink(order.customer.phone)}` : "",
    },
    issueTypeOptions: VERIFICATION_ISSUE_TYPE_OPTIONS,
    itemCount: verificationStats.totalItems,
    items: (order.items || []).map((item, index) => {
      const itemVerificationState = getItemVerificationState(item);

      return {
        id: normalizeText(item.clientId) || `item-${index + 1}`,
        imageUrl: normalizeText(item.imageUrl),
        index,
        itemName: item.itemName,
        notes: normalizeText(item.notes),
        quantity: Number(item.quantity) || 1,
        service: normalizeText(item.service),
        verification: itemVerificationState,
      };
    }),
    orderId: order.orderNumber,
    orderNotes: normalizeText(verificationState.orderNotes),
    orderStatus: order.status,
    paymentStatus: order.paymentStatus,
    scheduledFor: order.scheduledFor,
    severityOptions: VERIFICATION_SEVERITY_OPTIONS,
    specialHandlingText:
      normalizeText(order.notes) || "No special handling instructions were added for this order.",
    submittedAt: order.createdAt,
    verification: {
      completedAt: verificationState.completedAt || null,
      flaggedItems: verificationStats.flaggedItems,
      missingItems: verificationStats.missingItems,
      notifyCustomer:
        verificationState.notifyCustomer === undefined
          ? true
          : Boolean(verificationState.notifyCustomer),
      pendingItems: verificationStats.pendingItems,
      startedAt: verificationState.startedAt || null,
      status: verificationStatus,
      updatedAt: verificationState.updatedAt || order.updatedAt,
      verifiedItems: verificationStats.verifiedItems,
    },
  };
};

const formatPhoneLink = (value) => String(value || "").replace(/[^\d+]/g, "");

const requireCustomerRole = (req, res) => {
  if (req.user.role !== "customer") {
    res.status(403).json({ message: "Only customers can manage customer orders." });
    return false;
  }

  return true;
};

const requireStaffRole = (req, res) => {
  if (!STAFF_ELIGIBLE_ROLES.has(req.user.role)) {
    res.status(403).json({ message: "Only staff or admin users can access staff dashboards." });
    return false;
  }

  return true;
};

const getCustomerOrderQuery = (req) => ({
  _id: req.params.orderId,
  customer: req.user._id,
});

const findCustomerOrder = async (req) =>
  Order.findOne(getCustomerOrderQuery(req)).populate("customer", "name email phone");

const findCustomerOrderById = async (customerId, orderId) =>
  Order.findOne({
    _id: orderId,
    customer: customerId,
  }).populate("customer", "name email phone");

const createPickupShareToken = () => crypto.randomBytes(18).toString("base64url");

const getStaffOrderQuery = (orderId) => {
  const normalizedOrderId = normalizeText(orderId);
  const orConditions = [{ orderNumber: normalizedOrderId }];

  if (/^[a-f\d]{24}$/i.test(normalizedOrderId)) {
    orConditions.push({ _id: normalizedOrderId });
  }

  return {
    $or: orConditions,
  };
};

const findStaffOrder = async (orderId) =>
  Order.findOne(getStaffOrderQuery(orderId)).populate("customer", "name email phone");

const formatDateTime = (value, options = {}) =>
  new Intl.DateTimeFormat("en-US", options).format(new Date(value));

const formatRelativeSubmission = (value) => {
  const submittedAt = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfSubmittedDay = new Date(
    submittedAt.getFullYear(),
    submittedAt.getMonth(),
    submittedAt.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfSubmittedDay.getTime()) / (1000 * 60 * 60 * 24),
  );
  const timeLabel = formatDateTime(submittedAt, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (dayDifference === 0) {
    return `Today at ${timeLabel}`;
  }

  if (dayDifference === 1) {
    return `Yesterday at ${timeLabel}`;
  }

  return `${formatDateTime(submittedAt, {
    month: "short",
    day: "numeric",
  })} at ${timeLabel}`;
};

const getStartOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getDateKey = (value = new Date()) => getStartOfDay(value).toISOString().split("T")[0];

const getEndOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const formatOverdueText = (scheduledFor) => {
  const hoursOverdue = Math.max(
    Math.round((Date.now() - new Date(scheduledFor).getTime()) / (1000 * 60 * 60)),
    1,
  );

  if (hoursOverdue < 24) {
    return `${hoursOverdue} hour${hoursOverdue === 1 ? "" : "s"} overdue`;
  }

  const daysOverdue = Math.round(hoursOverdue / 24);
  return `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`;
};

const getPickupSectionLabel = (scheduledFor) => {
  if (!scheduledFor) {
    return "Unscheduled Pickups";
  }

  const scheduledDate = new Date(scheduledFor);
  const hour = scheduledDate.getHours();

  return (
    PICKUP_WINDOW_LABELS.find(
      (windowLabel) => hour >= windowLabel.fromHour && hour < windowLabel.toHour,
    )?.label || "Other Pickup Times"
  );
};

const getPickupSectionDefinition = (scheduledFor) => {
  const scheduledDate = new Date(scheduledFor);
  const hour = scheduledDate.getHours();

  return (
    PICKUP_SECTION_DEFINITIONS.find(
      (section) => hour >= section.startHour && hour < section.endHour,
    ) || PICKUP_SECTION_DEFINITIONS[PICKUP_SECTION_DEFINITIONS.length - 1]
  );
};

const createDefaultPickupCapacitySlots = () =>
  PICKUP_SECTION_DEFINITIONS.map((section) => ({
    capacity: DEFAULT_PICKUP_CAPACITY_BY_SECTION[section.id] || 0,
    id: section.id,
    isBlocked: false,
  }));

const getPickupScheduleConfigForDate = async (dateKey) => {
  const existingConfig = await PickupScheduleConfig.findOne({ dateKey });

  if (existingConfig) {
    return existingConfig;
  }

  return {
    dateKey,
    slots: createDefaultPickupCapacitySlots(),
    specialHoursEnabled: false,
  };
};

const normalizePickupCapacityPayload = (body, dateKey) => {
  const incomingSlots = Array.isArray(body?.capacityManagement?.slots)
    ? body.capacityManagement.slots
    : Array.isArray(body?.slots)
      ? body.slots
      : null;

  if (!incomingSlots) {
    return {
      message: "Pickup capacity slots must be provided as an array.",
      status: 400,
    };
  }

  const normalizedSlots = createDefaultPickupCapacitySlots().map((defaultSlot) => {
    const incomingSlot = incomingSlots.find((slot) => slot?.id === defaultSlot.id);

    if (!incomingSlot) {
      return defaultSlot;
    }

    const normalizedCapacity = Number(incomingSlot.capacity);

    if (!Number.isFinite(normalizedCapacity) || normalizedCapacity < 0) {
      return {
        error: `Capacity for ${defaultSlot.id} must be a valid non-negative number.`,
      };
    }

    return {
      capacity: normalizedCapacity,
      id: defaultSlot.id,
      isBlocked: Boolean(incomingSlot.isBlocked),
    };
  });

  const invalidSlot = normalizedSlots.find((slot) => slot.error);

  if (invalidSlot) {
    return {
      message: invalidSlot.error,
      status: 400,
    };
  }

  return {
    dateKey,
    slots: normalizedSlots,
    specialHoursEnabled: Boolean(body?.capacityManagement?.specialHoursEnabled ?? body?.specialHoursEnabled),
  };
};

const getPickupStatusPresentation = (status) => {
  switch (status) {
    case "completed":
      return {
        actionLabel: "Ready for Pickup",
        isActionActive: true,
        label: "Ready",
      };
    case "in-progress":
      return {
        actionLabel: "Update Status",
        isActionActive: false,
        label: "Processing",
      };
    case "confirmed":
      return {
        actionLabel: "Confirm Pickup",
        isActionActive: true,
        label: "Preparing",
      };
    case "pending":
    default:
      return {
        actionLabel: "Start Verification",
        isActionActive: false,
        label: "Needs Verification",
      };
  }
};

const getPickupStatusClassName = (status) => {
  switch (status) {
    case "completed":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "in-progress":
      return "bg-[#dce8f6] text-[var(--color-primary)]";
    case "confirmed":
      return "bg-[var(--color-warm-soft)] text-[var(--color-primary)]";
    case "pending":
    default:
      return "bg-slate-100 text-slate-600";
  }
};

const getProcessingProgress = (status) => {
  switch (status) {
    case "completed":
      return 100;
    case "in-progress":
      return 68;
    case "confirmed":
      return 24;
    case "pending":
    default:
      return 10;
  }
};

const getProcessingStageLabel = (status, serviceType) => {
  if (status === "completed") {
    return "Ready";
  }

  if (status === "in-progress") {
    const normalizedServiceType = String(serviceType || "").toLowerCase();

    if (normalizedServiceType.includes("dry")) {
      return "Drying";
    }

    if (normalizedServiceType.includes("iron")) {
      return "Ironing";
    }

    return "Washing";
  }

  if (status === "confirmed") {
    return "Queued";
  }

  return "Verification";
};

const getProcessingBadgeClassName = (status) => {
  switch (status) {
    case "completed":
      return "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
    case "in-progress":
      return "bg-[var(--color-warm-soft)] text-[var(--color-primary)]";
    case "confirmed":
      return "bg-[#dce8f6] text-[var(--color-primary)]";
    case "pending":
    default:
      return "bg-slate-100 text-slate-600";
  }
};

const getPickupScheduleBadge = (status) => {
  switch (status) {
    case "completed":
      return {
        buttonClassName: "",
        label: "Ready",
        statusBadgeClassName: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
      };
    case "in-progress":
      return {
        buttonClassName: "opacity-55",
        label: "In Progress",
        statusBadgeClassName: "bg-[var(--color-warm-soft)] text-[var(--color-primary)]",
      };
    case "confirmed":
      return {
        buttonClassName: "",
        label: "Confirmed",
        statusBadgeClassName: "bg-[#dce8f6] text-[var(--color-primary)]",
      };
    case "pending":
    default:
      return {
        buttonClassName: "opacity-55",
        label: "Needs Verification",
        statusBadgeClassName: "bg-slate-100 text-slate-600",
      };
  }
};

const getPickupSectionStatusPresentation = (
  orders,
  sectionDefinition,
  selectedDate,
  slotConfig,
) => {
  if (slotConfig?.isBlocked) {
    return {
      statusClassName: "bg-slate-100 text-slate-600",
      statusText: "Blocked",
    };
  }

  const sectionOrders = orders.filter((order) => {
    const definition = getPickupSectionDefinition(order.scheduledFor);
    return definition.id === sectionDefinition.id;
  });
  const completedCount = sectionOrders.filter((order) => order.status === "completed").length;
  const fillCount = sectionOrders.length;
  const now = new Date();
  const selectedDay = getStartOfDay(selectedDate);
  const isToday =
    selectedDay.getTime() === getStartOfDay(now).getTime();

  if (completedCount > 0 && completedCount === fillCount && fillCount > 0) {
    return {
      statusClassName: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
      statusText: "Completed",
    };
  }

  if (
    isToday &&
    now.getHours() >= sectionDefinition.startHour &&
    now.getHours() < sectionDefinition.endHour
  ) {
    return {
      statusClassName: "bg-[var(--color-warm-soft)] text-[var(--color-primary)]",
      statusText: "Current Slot",
    };
  }

  return {
    statusClassName: "bg-[#dce8f6] text-[var(--color-primary)]",
    statusText: "Upcoming",
  };
};

const buildStaffDashboardPayload = (orders, staffUser) => {
  const serializedOrders = orders.map(serializeStaffDashboardOrder);
  const pendingVerificationOrders = serializedOrders
    .filter((order) => order.status === "pending")
    .slice(0, 6)
    .map((order) => ({
      customer: order.customer?.name || "Customer",
      id: order.orderNumber,
      images: order.imageUrls.slice(0, 3),
      items: order.itemCount,
      statusKey: "pending",
      rush: false,
      submittedAt: formatRelativeSubmission(order.createdAt),
    }));
  const inProcessOrders = serializedOrders
    .filter((order) => order.status === "in-progress" || order.status === "confirmed")
    .slice(0, 6)
    .map((order) => ({
      badgeClassName: getProcessingBadgeClassName(order.status),
      id: order.orderNumber,
      image: order.imageUrls[0] || "",
      progress: getProcessingProgress(order.status),
      stage: getProcessingStageLabel(order.status, order.serviceType),
      statusKey: order.status,
      time: order.updatedAt
        ? formatRelativeSubmission(order.updatedAt)
        : "Awaiting update",
    }));
  const pickupSectionsMap = new Map();

  serializedOrders
    .filter((order) => order.scheduledFor && order.status !== "cancelled")
    .sort((left, right) => new Date(left.scheduledFor) - new Date(right.scheduledFor))
    .forEach((order) => {
      const label = getPickupSectionLabel(order.scheduledFor);
      const statusPresentation = getPickupStatusPresentation(order.status);
      const entry = pickupSectionsMap.get(label) || [];

      const isOverdue =
        order.status !== "completed" &&
        order.status !== "cancelled" &&
        new Date(order.scheduledFor).getTime() < Date.now();

      entry.push({
        actionLabel: statusPresentation.actionLabel,
        customer: order.customer?.name || "Customer",
        id: order.orderNumber,
        isActionActive: statusPresentation.isActionActive,
        isOverdue,
        items: order.itemCount,
        status: statusPresentation.label,
        statusClassName: getPickupStatusClassName(order.status),
        statusKey: order.status,
        time: formatDateTime(order.scheduledFor, {
          hour: "numeric",
          minute: "2-digit",
        }),
      });

      pickupSectionsMap.set(label, entry);
    });

  const pickupSections = Array.from(pickupSectionsMap.entries()).map(([label, groupedOrders]) => ({
    label,
    orders: groupedOrders,
  }));
  const todaysPickupCount = serializedOrders.filter((order) => {
    if (!order.scheduledFor || order.status === "cancelled") {
      return false;
    }

    const scheduledDate = new Date(order.scheduledFor);
    const now = new Date();

    return (
      scheduledDate.getFullYear() === now.getFullYear() &&
      scheduledDate.getMonth() === now.getMonth() &&
      scheduledDate.getDate() === now.getDate()
    );
  }).length;

  return {
    generatedAt: new Date().toISOString(),
    inProcessOrders,
    pendingVerificationOrders,
    pickupSections,
    quickActions: [
      {
        count: pendingVerificationOrders.length,
        id: "scan",
        label: "Scan Order QR Code",
        variant: "primary",
      },
      {
        count: serializedOrders.length,
        id: "lookup",
        label: "Manual Order Lookup",
        variant: "secondary",
      },
      {
        count: serializedOrders.filter((order) => order.status === "cancelled").length,
        id: "issue",
        label: "Report Issue",
        variant: "secondary",
      },
    ],
    quickFilters: [
      {
        count: serializedOrders.length,
        key: "all",
        label: "All Orders",
      },
      {
        count: pendingVerificationOrders.length,
        key: "pending",
        label: "Needs Verification",
      },
      {
        count: inProcessOrders.length,
        key: "in-progress",
        label: "In Process",
      },
      {
        count: serializedOrders.filter((order) => order.status === "completed").length,
        key: "completed",
        label: "Ready for Pickup",
      },
      {
        count: serializedOrders.filter((order) => {
          if (!order.scheduledFor || order.status === "cancelled" || order.status === "completed") {
            return false;
          }

          return new Date(order.scheduledFor).getTime() < Date.now();
        }).length,
        key: "overdue",
        label: "Overdue",
      },
    ],
    shiftInformation: {
      currentShift: "8:00 AM - 4:00 PM",
      role: staffUser.role === "admin" ? "Operations Admin" : "Processing Specialist",
      staffMember: staffUser.name,
    },
    summaryItems: [
      {
        label: "Pending verification",
        value: pendingVerificationOrders.length,
      },
      {
        label: "In-process orders",
        value: inProcessOrders.length,
      },
      {
        label: "Ready for pickup",
        value: serializedOrders.filter((order) => order.status === "completed").length,
      },
      {
        label: "Today's pickups",
        value: todaysPickupCount,
      },
    ],
  };
};

const applyOrderPayload = async (order, body) => {
  const normalizedServiceType = normalizeText(body.serviceType || body.service);
  const normalizedPickupAddress = normalizeText(body.pickupAddress || body.address);
  const normalizedDeliveryAddress = normalizeText(
    body.deliveryAddress || body.dropoffAddress || normalizedPickupAddress,
  );
  const normalizedNotes = normalizeText(body.notes || body.specialInstructions);
  const normalizedItems = await normalizeItems(body.items);
  const scheduledFor = normalizeDate(body.scheduledFor || body.pickupDate);

  if (!normalizedServiceType || !normalizedPickupAddress) {
    return {
      status: 400,
      message: "Service type and pickup address are required.",
    };
  }

  if (!normalizedDeliveryAddress) {
    return {
      status: 400,
      message: "Delivery address is required.",
    };
  }

  if ((body.scheduledFor || body.pickupDate) && !scheduledFor) {
    return {
      status: 400,
      message: "Scheduled date must be a valid date.",
    };
  }

  if (normalizedItems === null) {
    return {
      status: 400,
      message: "Items must be provided as an array.",
    };
  }

  const hasInvalidItem = validateNormalizedItems(normalizedItems);

  if (hasInvalidItem) {
    return {
      status: 400,
      message: "Each item must include a name, quantity of at least 1, and a valid unit price.",
    };
  }

  const totalAmount =
    body.totalAmount === undefined ? calculateTotalAmount(normalizedItems) : Number(body.totalAmount);

  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return {
      status: 400,
      message: "Total amount must be a valid non-negative number.",
    };
  }

  order.serviceType = normalizedServiceType;
  order.pickupAddress = normalizedPickupAddress;
  order.deliveryAddress = normalizedDeliveryAddress;
  order.scheduledFor = scheduledFor;
  order.notes = normalizedNotes;
  order.items = normalizedItems;
  order.totalAmount = totalAmount;

  return null;
};

const normalizeVerificationChecklistPayload = (value, fallbackChecklist = {}) => ({
  categoryCorrect:
    value?.categoryCorrect === undefined
      ? Boolean(fallbackChecklist.categoryCorrect)
      : Boolean(value.categoryCorrect),
  colorAccurate:
    value?.colorAccurate === undefined
      ? Boolean(fallbackChecklist.colorAccurate)
      : Boolean(value.colorAccurate),
  conditionAsDescribed:
    value?.conditionAsDescribed === undefined
      ? Boolean(fallbackChecklist.conditionAsDescribed)
      : Boolean(value.conditionAsDescribed),
  itemMatchesPhoto:
    value?.itemMatchesPhoto === undefined
      ? Boolean(fallbackChecklist.itemMatchesPhoto)
      : Boolean(value.itemMatchesPhoto),
});

const applyVerificationPayload = async (order, body, staffUser) => {
  const itemUpdates = body.items;

  if (itemUpdates !== undefined && !Array.isArray(itemUpdates)) {
    return {
      status: 400,
      message: "Verification items must be provided as an array.",
    };
  }

  const updatesByIndex = new Map();

  for (const itemUpdate of itemUpdates || []) {
    const itemIndex = Number(itemUpdate?.index);

    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
      return {
        status: 400,
        message: "Each verification item must include a valid index.",
      };
    }

    updatesByIndex.set(itemIndex, itemUpdate);
  }

  for (const [itemIndex, itemUpdate] of updatesByIndex.entries()) {
    const targetItem = order.items[itemIndex];
    const existingVerificationState = getItemVerificationState(targetItem);
    const normalizedStatusInput = normalizeText(itemUpdate?.status).toLowerCase();
    const normalizedSeverityInput = normalizeText(itemUpdate?.severity).toLowerCase();
    const documentationImageData = normalizeText(itemUpdate?.documentationImageData);
    let documentationImageUrl =
      itemUpdate?.documentationImageUrl === undefined
        ? existingVerificationState.documentationImageUrl
        : normalizeText(itemUpdate.documentationImageUrl);
    let documentationImagePath =
      itemUpdate?.documentationImagePath === undefined
        ? normalizeText(targetItem.verification?.documentationImagePath)
        : normalizeText(itemUpdate.documentationImagePath);

    if (normalizedStatusInput && !VERIFICATION_ITEM_STATUSES.has(normalizedStatusInput)) {
      return {
        status: 400,
        message: "Verification item status is invalid.",
      };
    }

    if (normalizedSeverityInput && !VERIFICATION_SEVERITY_OPTIONS.includes(normalizedSeverityInput)) {
      return {
        status: 400,
        message: "Verification severity level is invalid.",
      };
    }

    if (documentationImageData) {
      const storedImage = await saveImageDataUrl(
        documentationImageData,
        `verification-${order.orderNumber}-${itemIndex + 1}`,
      );
      documentationImageUrl = storedImage.imageUrl;
      documentationImagePath = storedImage.imagePath;
    }

    const nextStatus = normalizedStatusInput || existingVerificationState.status;
    const nextChecklist = normalizeVerificationChecklistPayload(
      itemUpdate?.checklist,
      existingVerificationState.checklist,
    );
    const nextVerificationState = {
      checklist: nextChecklist,
      documentationImagePath,
      documentationImageUrl,
      issueType:
        itemUpdate?.issueType === undefined
          ? existingVerificationState.issueType
          : normalizeText(itemUpdate.issueType),
      notes:
        itemUpdate?.notes === undefined
          ? existingVerificationState.notes
          : normalizeText(itemUpdate.notes),
      severity:
        itemUpdate?.severity === undefined
          ? existingVerificationState.severity
          : normalizedSeverityInput,
      status: nextStatus,
      updatedAt: new Date(),
      verifiedAt:
        nextStatus === "verified"
          ? existingVerificationState.verifiedAt || new Date()
          : null,
    };

    if (nextStatus === "verified") {
      nextVerificationState.issueType = "";
      nextVerificationState.notes = nextVerificationState.notes;
      nextVerificationState.severity = "";
    }

    if (nextStatus === "missing") {
      nextVerificationState.checklist = buildEmptyVerificationChecklist();
    }

    targetItem.verification = nextVerificationState;
  }

  const existingOrderVerification = order.verification || {};
  const normalizedNotifyCustomer =
    body.notifyCustomer === undefined
      ? existingOrderVerification.notifyCustomer !== false
      : Boolean(body.notifyCustomer);
  const normalizedOrderNotes =
    body.orderNotes === undefined
      ? normalizeText(existingOrderVerification.orderNotes)
      : normalizeText(body.orderNotes);
  const shouldCompleteVerification = Boolean(body.completeVerification);
  const progressExists = hasVerificationProgress(order) || Boolean(normalizedOrderNotes);
  const verificationStats = getVerificationStats(order.items || []);
  const now = new Date();

  if (shouldCompleteVerification && verificationStats.pendingItems > 0) {
    return {
      status: 400,
      message: "Verify, flag, or mark every item before completing verification.",
    };
  }

  order.verification = {
    completedAt: shouldCompleteVerification ? now : null,
    notifyCustomer: normalizedNotifyCustomer,
    orderNotes: normalizedOrderNotes,
    startedAt:
      shouldCompleteVerification || progressExists
        ? existingOrderVerification.startedAt || now
        : null,
    status: shouldCompleteVerification
      ? "completed"
      : progressExists
        ? "in-progress"
        : "not-started",
    updatedAt: progressExists || shouldCompleteVerification ? now : null,
    updatedBy:
      progressExists || shouldCompleteVerification ? staffUser?._id || null : null,
  };

  if (shouldCompleteVerification && order.status === "pending") {
    order.status = "confirmed";
  }

  order.markModified("items");
  order.markModified("verification");

  return null;
};

export const getStaffVerificationOrder = async (req, res) => {
  try {
    if (!requireStaffRole(req, res)) {
      return undefined;
    }

    const order = await findStaffOrder(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: "Verification order not found." });
    }

    return res.status(200).json({
      verificationOrder: serializeVerificationOrder(order),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to load the verification order.",
    });
  }
};

export const updateStaffVerificationOrder = async (req, res) => {
  try {
    if (!requireStaffRole(req, res)) {
      return undefined;
    }

    const order = await findStaffOrder(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: "Verification order not found." });
    }

    if (order.status === "cancelled") {
      return res.status(400).json({
        message: "Cancelled orders cannot be verified.",
      });
    }

    const validationError = await applyVerificationPayload(order, req.body, req.user);

    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    await order.save();

    return res.status(200).json({
      message: req.body?.completeVerification
        ? "Verification completed successfully."
        : "Verification progress saved.",
      verificationOrder: serializeVerificationOrder(order),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to update verification progress.",
    });
  }
};

export const createOrder = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const order = new Order({
      customer: req.user._id,
    });
    const validationError = await applyOrderPayload(order, req.body);

    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    await order.save();

    return res.status(201).json({
      message: "Order created successfully.",
      order: serializeOrder(order),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Unable to generate a unique order number. Please try again." });
    }

    return res.status(500).json({ message: error.message || "Unable to create order." });
  }
};

export const updateCustomerOrder = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const order = await findCustomerOrder(req);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (!CUSTOMER_ORDER_CANCELLABLE_STATUSES.has(order.status)) {
      return res.status(400).json({
        message: "Only pending or confirmed orders can be updated by the customer.",
      });
    }

    const validationError = await applyOrderPayload(order, req.body);

    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    await order.save();

    return res.status(200).json({
      message: "Order updated successfully.",
      order: serializeOrder(order),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to update order." });
  }
};

export const getCustomerOrders = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const orders = await Order.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .populate("customer", "name email phone");

    return res.status(200).json({
      orders: orders.map(serializeOrder),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch orders." });
  }
};

export const getCustomerOrderById = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const order = await findCustomerOrder(req);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    return res.status(200).json({
      order: serializeOrder(order),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to fetch order." });
  }
};

export const createCustomerOrderShareLink = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const order = await findCustomerOrderById(req.user._id, req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (!order.pickupShare?.token) {
      order.pickupShare = {
        createdAt: new Date(),
        token: createPickupShareToken(),
      };
      order.markModified("pickupShare");
      await order.save();
    }

    return res.status(200).json({
      message: "Pickup share link is ready.",
      share: {
        generatedAt: order.pickupShare.createdAt,
        shareToken: order.pickupShare.token,
      },
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Order not found." });
    }

    return res.status(500).json({
      message: error.message || "Unable to generate a pickup share link.",
    });
  }
};

export const getSharedPickupOrder = async (req, res) => {
  try {
    const shareToken = normalizeText(req.params.shareToken);

    if (!shareToken) {
      return res.status(400).json({ message: "Share token is required." });
    }

    const order = await Order.findOne({
      "pickupShare.token": shareToken,
    }).populate("customer", "name");

    if (!order) {
      return res.status(404).json({ message: "Shared pickup order not found." });
    }

    return res.status(200).json({
      order: serializeSharedPickupOrder(order),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to load the shared pickup order.",
    });
  }
};

export const cancelCustomerOrder = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const order = await findCustomerOrder(req);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.status === "cancelled") {
      return res.status(400).json({ message: "This order has already been cancelled." });
    }

    if (!CUSTOMER_ORDER_CANCELLABLE_STATUSES.has(order.status)) {
      return res.status(400).json({
        message: "Only pending or confirmed orders can be cancelled by the customer.",
      });
    }

    order.status = "cancelled";
    await order.save();

    return res.status(200).json({
      message: "Order cancelled successfully.",
      order: serializeOrder(order),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to cancel order." });
  }
};

export const getStaffDashboard = async (req, res) => {
  try {
    if (!requireStaffRole(req, res)) {
      return undefined;
    }

    const orders = await Order.find({
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("customer", "name email phone");

    return res.status(200).json({
      dashboard: buildStaffDashboardPayload(orders, req.user),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch the staff dashboard.",
    });
  }
};

export const getStaffPickupSchedule = async (req, res) => {
  try {
    if (!requireStaffRole(req, res)) {
      return undefined;
    }

    const requestedDate = normalizeDate(req.query.date) || new Date();
    const startOfSelectedDay = getStartOfDay(requestedDate);
    const endOfSelectedDay = getEndOfDay(requestedDate);
    const dateKey = getDateKey(requestedDate);
    const pickupCapacityConfig = await getPickupScheduleConfigForDate(dateKey);
    const slotConfigMap = new Map(
      (pickupCapacityConfig.slots || createDefaultPickupCapacitySlots()).map((slot) => [slot.id, slot]),
    );
    const selectedDayOrders = await Order.find({
      scheduledFor: {
        $gte: startOfSelectedDay,
        $lte: endOfSelectedDay,
      },
      status: { $ne: "cancelled" },
    })
      .sort({ scheduledFor: 1, createdAt: -1 })
      .populate("customer", "name email phone");
    const overdueOrders = await Order.find({
      scheduledFor: { $lt: startOfSelectedDay },
      status: {
        $in: ["pending", "confirmed", "in-progress"],
      },
    })
      .sort({ scheduledFor: 1 })
      .limit(6)
      .populate("customer", "name email phone");

    const serializedSelectedDayOrders = selectedDayOrders.map(serializeStaffDashboardOrder);
    const serializedOverdueOrders = overdueOrders.map(serializeStaffDashboardOrder);
    const scheduleSections = PICKUP_SECTION_DEFINITIONS.map((sectionDefinition) => {
      const slotConfig =
        slotConfigMap.get(sectionDefinition.id) ||
        createDefaultPickupCapacitySlots().find((slot) => slot.id === sectionDefinition.id);
      const sectionOrders = serializedSelectedDayOrders
        .filter((order) => getPickupSectionDefinition(order.scheduledFor).id === sectionDefinition.id)
        .map((order) => {
          const pickupBadge = getPickupScheduleBadge(order.status);

          return {
            buttonClassName: pickupBadge.buttonClassName,
            contactEmail: order.customer?.email || "",
            contactPhone: order.customer?.phone || "",
            customer: order.customer?.name || "Customer",
            id: order.orderNumber,
            itemBadgeClassName: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
            items: order.itemCount,
            readyText:
              order.status !== "completed" && order.updatedAt
                ? `Last update: ${formatRelativeSubmission(order.updatedAt)}`
                : "",
            scheduleText: `Scheduled: ${formatDateTime(order.scheduledFor, {
              hour: "numeric",
              minute: "2-digit",
            })}`,
            status: pickupBadge.label,
            statusBadgeClassName: pickupBadge.statusBadgeClassName,
          };
        });
      const statusPresentation = getPickupSectionStatusPresentation(
        serializedSelectedDayOrders,
        sectionDefinition,
        requestedDate,
        slotConfig,
      );

      return {
        fillText: `${sectionOrders.length} of ${slotConfig?.capacity ?? 0} slots filled`,
        id: sectionDefinition.id,
        orders: sectionOrders,
        statusClassName: statusPresentation.statusClassName,
        statusText: statusPresentation.statusText,
        title: sectionDefinition.title,
      };
    });

    return res.status(200).json({
      pickupSchedule: {
        capacityManagement: {
          slots: PICKUP_SECTION_DEFINITIONS.map((sectionDefinition) => {
            const slotConfig =
              slotConfigMap.get(sectionDefinition.id) ||
              createDefaultPickupCapacitySlots().find((slot) => slot.id === sectionDefinition.id);

            return {
              capacity: slotConfig?.capacity ?? 0,
              id: sectionDefinition.id,
              isBlocked: Boolean(slotConfig?.isBlocked),
              label: sectionDefinition.title.replace(" Slot", ""),
            };
          }),
          specialHoursEnabled: Boolean(pickupCapacityConfig.specialHoursEnabled),
        },
        generatedAt: new Date().toISOString(),
        overduePickups: serializedOverdueOrders.map((order) => ({
          contactEmail: order.customer?.email || "",
          contactPhone: order.customer?.phone || "",
          customer: order.customer?.name || "Customer",
          id: order.orderNumber,
          items: order.itemCount,
          overdueText: formatOverdueText(order.scheduledFor),
          scheduledDate: formatDateTime(order.scheduledFor, {
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        })),
        selectedDate: startOfSelectedDay.toISOString(),
        statCards: [
          {
            id: "scheduled",
            label: "Total Scheduled",
            value: serializedSelectedDayOrders.length,
          },
          {
            id: "completed",
            label: "Completed",
            value: serializedSelectedDayOrders.filter((order) => order.status === "completed").length,
          },
          {
            id: "remaining",
            label: "Remaining",
            value: serializedSelectedDayOrders.filter((order) => order.status !== "completed").length,
          },
          {
            id: "current",
            label: "Current Slot",
            value:
              PICKUP_SECTION_DEFINITIONS.find((section) => {
                const now = new Date();
                return (
                  startOfSelectedDay.getTime() === getStartOfDay(now).getTime() &&
                  now.getHours() >= section.startHour &&
                  now.getHours() < section.endHour
                );
              })?.title.replace(" Slot", "") || "Upcoming",
          },
        ],
        scheduleSections,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to fetch the staff pickup schedule.",
    });
  }
};

export const updateStaffPickupCapacity = async (req, res) => {
  try {
    if (!requireStaffRole(req, res)) {
      return undefined;
    }

    const requestedDate = normalizeDate(req.body?.date) || new Date();
    const dateKey = getDateKey(requestedDate);
    const normalizedPayload = normalizePickupCapacityPayload(req.body, dateKey);

    if (normalizedPayload.status) {
      return res.status(normalizedPayload.status).json({ message: normalizedPayload.message });
    }

    await PickupScheduleConfig.findOneAndUpdate(
      { dateKey },
      {
        $set: {
          slots: normalizedPayload.slots,
          specialHoursEnabled: normalizedPayload.specialHoursEnabled,
          updatedBy: req.user._id,
        },
      },
      {
        new: true,
        setDefaultsOnInsert: true,
        upsert: true,
      },
    );

    req.query.date = dateKey;
    return getStaffPickupSchedule(req, res);
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to update pickup capacity.",
    });
  }
};
