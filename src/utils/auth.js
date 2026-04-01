import crypto from "crypto";

const TOKEN_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7;

const getSecret = () => process.env.AUTH_SECRET || "washa-dev-auth-secret";
const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyPassword = (password, storedValue) => {
  const [salt, existingHash] = storedValue.split(":");

  if (!salt || !existingHash) {
    return false;
  }

  const incomingHash = crypto.scryptSync(password, salt, 64).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(existingHash, "hex"),
    Buffer.from(incomingHash, "hex"),
  );
};

export const createAuthToken = (user) => {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    name: user.name,
    email: user.email,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };

  const encodedHeader = toBase64Url(header);
  const encodedPayload = toBase64Url(payload);
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (token) => {
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Invalid token format");
  }

  const expectedSignature = crypto
    .createHmac("sha256", getSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
};
