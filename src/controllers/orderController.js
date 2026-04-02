import Order from "../models/Order.js";
import {
  calculateTotalAmount,
  normalizeDate,
  normalizeItems,
  normalizeText,
  validateNormalizedItems,
} from "../utils/orderPayload.js";

const CUSTOMER_ORDER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);

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

const requireCustomerRole = (req, res) => {
  if (req.user.role !== "customer") {
    res.status(403).json({ message: "Only customers can manage customer orders." });
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
