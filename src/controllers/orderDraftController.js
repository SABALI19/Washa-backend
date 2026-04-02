import OrderDraft from "../models/OrderDraft.js";
import {
  calculateTotalAmount,
  normalizeDate,
  normalizeItems,
  normalizeText,
  validateNormalizedItems,
} from "../utils/orderPayload.js";

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

const serializeDraft = (draft) => ({
  id: draft._id,
  customer: serializeCustomer(draft.customer),
  serviceType: draft.serviceType,
  pickupAddress: draft.pickupAddress,
  deliveryAddress: draft.deliveryAddress,
  pickupWindow: draft.pickupWindow,
  scheduledFor: draft.scheduledFor,
  notes: draft.notes,
  items: draft.items,
  totalAmount: draft.totalAmount,
  currentStep: draft.currentStep,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
});

const requireCustomerRole = (req, res) => {
  if (req.user.role !== "customer") {
    res.status(403).json({ message: "Only customers can manage order drafts." });
    return false;
  }

  return true;
};

const findCustomerDraft = async (req) =>
  OrderDraft.findOne({
    _id: req.params.draftId,
    customer: req.user._id,
  }).populate("customer", "name email phone");

const applyDraftPayload = async (draft, body) => {
  const normalizedItems = await normalizeItems(body.items);
  const scheduledFor = normalizeDate(body.scheduledFor || body.pickupDate);
  const currentStep =
    body.currentStep === undefined ? draft.currentStep || 1 : Number(body.currentStep);

  if (normalizedItems === null) {
    return {
      status: 400,
      message: "Items must be provided as an array.",
    };
  }

  if (validateNormalizedItems(normalizedItems)) {
    return {
      status: 400,
      message: "Each draft item must include a name, quantity of at least 1, and a valid unit price.",
    };
  }

  if ((body.scheduledFor || body.pickupDate) && !scheduledFor) {
    return {
      status: 400,
      message: "Scheduled date must be a valid date.",
    };
  }

  if (!Number.isFinite(currentStep) || currentStep < 1) {
    return {
      status: 400,
      message: "Current step must be a valid positive number.",
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

  const normalizedPickupAddress = normalizeText(body.pickupAddress || body.address);

  draft.serviceType = normalizeText(body.serviceType || body.service);
  draft.pickupAddress = normalizedPickupAddress;
  draft.deliveryAddress = normalizeText(
    body.deliveryAddress || body.dropoffAddress || normalizedPickupAddress,
  );
  draft.pickupWindow = normalizeText(body.pickupWindow);
  draft.scheduledFor = scheduledFor;
  draft.notes = normalizeText(body.notes || body.specialInstructions);
  draft.items = normalizedItems;
  draft.totalAmount = totalAmount;
  draft.currentStep = currentStep;

  return null;
};

export const getLatestCustomerDraft = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const draft = await OrderDraft.findOne({ customer: req.user._id })
      .sort({ updatedAt: -1 })
      .populate("customer", "name email phone");

    if (!draft) {
      return res.status(404).json({ message: "No draft order found." });
    }

    return res.status(200).json({ draft: serializeDraft(draft) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch draft." });
  }
};

export const getCustomerDraftById = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const draft = await findCustomerDraft(req);

    if (!draft) {
      return res.status(404).json({ message: "Draft order not found." });
    }

    return res.status(200).json({ draft: serializeDraft(draft) });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Draft order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to fetch draft." });
  }
};

export const createDraft = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const draft = new OrderDraft({
      customer: req.user._id,
    });
    const validationError = await applyDraftPayload(draft, req.body);

    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    await draft.save();

    return res.status(201).json({
      message: "Draft saved successfully.",
      draft: serializeDraft(draft),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to save draft." });
  }
};

export const updateDraft = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const draft = await findCustomerDraft(req);

    if (!draft) {
      return res.status(404).json({ message: "Draft order not found." });
    }

    const validationError = await applyDraftPayload(draft, req.body);

    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    await draft.save();

    return res.status(200).json({
      message: "Draft updated successfully.",
      draft: serializeDraft(draft),
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Draft order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to update draft." });
  }
};

export const deleteDraft = async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) {
      return undefined;
    }

    const draft = await findCustomerDraft(req);

    if (!draft) {
      return res.status(404).json({ message: "Draft order not found." });
    }

    await draft.deleteOne();

    return res.status(200).json({ message: "Draft deleted successfully." });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ message: "Draft order not found." });
    }

    return res.status(500).json({ message: error.message || "Unable to delete draft." });
  }
};
