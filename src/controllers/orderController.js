import Order from "../models/Order.js";
import {
  calculateTotalAmount,
  normalizeDate,
  normalizeItems,
  normalizeText,
  validateNormalizedItems,
} from "../utils/orderPayload.js";

const CUSTOMER_ORDER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);
const STAFF_ELIGIBLE_ROLES = new Set(["staff", "admin"]);
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
