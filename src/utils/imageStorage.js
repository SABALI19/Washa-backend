import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const uploadsRoot = path.resolve(process.cwd(), "uploads");
const orderUploadsDirectory = path.join(uploadsRoot, "orders");

const mimeExtensionMap = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const dataUrlPattern = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

export const ensureOrderUploadsDirectory = async () => {
  await fs.mkdir(orderUploadsDirectory, { recursive: true });
};

export const saveImageDataUrl = async (dataUrl, prefix = "order-item") => {
  const normalizedDataUrl = String(dataUrl || "").trim();
  const match = normalizedDataUrl.match(dataUrlPattern);

  if (!match) {
    throw new Error("Invalid image data supplied.");
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2];
  const extension = mimeExtensionMap[mimeType];

  if (!extension) {
    throw new Error("Unsupported image format.");
  }

  await ensureOrderUploadsDirectory();

  const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  const absoluteFilePath = path.join(orderUploadsDirectory, fileName);
  const relativeFilePath = `/uploads/orders/${fileName}`;

  await fs.writeFile(absoluteFilePath, Buffer.from(base64Payload, "base64"));

  return {
    imageUrl: relativeFilePath,
    imagePath: absoluteFilePath,
    mimeType,
  };
};

