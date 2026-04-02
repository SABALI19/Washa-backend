import { saveImageDataUrl } from "./imageStorage.js";

export const normalizeText = (value) => String(value || "").trim();

export const normalizeDate = (value) => {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

export const normalizeItems = async (items) => {
  if (items === undefined || items === null) {
    return [];
  }

  if (!Array.isArray(items)) {
    return null;
  }

  const normalizedItems = [];

  for (const item of items) {
    const normalizedItem = {
      clientId: normalizeText(item?.clientId || item?.id),
      itemName: normalizeText(item?.itemName || item?.name),
      quantity: Number(item?.quantity),
      unitPrice: item?.unitPrice === undefined ? 0 : Number(item.unitPrice),
      service: normalizeText(item?.service),
      notes: normalizeText(item?.notes),
      imageUrl: normalizeText(item?.imageUrl || item?.image),
      imagePath: normalizeText(item?.imagePath),
    };

    const imageData = normalizeText(item?.imageData);

    if (imageData) {
      const storedImage = await saveImageDataUrl(
        imageData,
        normalizedItem.clientId || "order-item",
      );
      normalizedItem.imageUrl = storedImage.imageUrl;
      normalizedItem.imagePath = storedImage.imagePath;
    }

    normalizedItems.push(normalizedItem);
  }

  return normalizedItems;
};

export const calculateTotalAmount = (items) =>
  items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

export const validateNormalizedItems = (items) =>
  items.some(
    (item) =>
      !item.itemName ||
      !Number.isFinite(item.quantity) ||
      item.quantity < 1 ||
      !Number.isFinite(item.unitPrice) ||
      item.unitPrice < 0,
  );
