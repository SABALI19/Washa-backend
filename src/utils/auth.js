import crypto from "crypto";

const HOUR_IN_MS = 1000 * 60 * 60;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 1000 * 60 * 15;
export const REFRESH_TOKEN_COOKIE_NAME = "washa_refresh_token";

const DEFAULT_SESSION_DURATION_BY_ROLE = {
  admin: 8 * HOUR_IN_MS,
  customer: 14 * DAY_IN_MS,
  staff: DAY_IN_MS,
};

const parseDurationMs = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
};

const getFallbackSecret = () => process.env.AUTH_SECRET || "washa-dev-auth-secret";
const getAccessTokenSecret = () => process.env.AUTH_ACCESS_SECRET || getFallbackSecret();
const getRefreshTokenSecret = () => process.env.AUTH_REFRESH_SECRET || getFallbackSecret();
const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const getAccessTokenTtlMs = () =>
  parseDurationMs(process.env.AUTH_ACCESS_TOKEN_TTL_MS) || DEFAULT_ACCESS_TOKEN_TTL_MS;

const getSessionDurationByRole = () => ({
  admin:
    parseDurationMs(process.env.AUTH_ADMIN_SESSION_TTL_MS) ||
    DEFAULT_SESSION_DURATION_BY_ROLE.admin,
  customer:
    parseDurationMs(process.env.AUTH_CUSTOMER_SESSION_TTL_MS) ||
    DEFAULT_SESSION_DURATION_BY_ROLE.customer,
  staff:
    parseDurationMs(process.env.AUTH_STAFF_SESSION_TTL_MS) ||
    DEFAULT_SESSION_DURATION_BY_ROLE.staff,
});

const createSignedToken = (payload, secret) => {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = toBase64Url(header);
  const encodedPayload = toBase64Url(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

const verifySignedToken = (token, secret, expectedType) => {
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Invalid token format");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  if (expectedType && payload.typ !== expectedType) {
    throw new Error("Invalid token type");
  }

  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
};

export const getSessionDurationForRole = (role, rememberMe = true) => {
  const sessionDurationByRole = getSessionDurationByRole();

  if (role === "customer" && !rememberMe) {
    return DAY_IN_MS;
  }

  return sessionDurationByRole[role] || DAY_IN_MS;
};

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

export const createAuthToken = (user, options = {}) => {
  const issuedAt = options.issuedAt || Date.now();
  const maxTokenTtlMs = options.expiresInMs || getAccessTokenTtlMs();
  const sessionExpiresAt = options.sessionExpiresAt || issuedAt + maxTokenTtlMs;
  const expiresAt = issuedAt + Math.min(maxTokenTtlMs, Math.max(sessionExpiresAt - issuedAt, 0));
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    name: user.name,
    email: user.email,
    exp: expiresAt,
    iat: issuedAt,
    sessionExp: sessionExpiresAt,
    typ: "access",
  };

  return {
    token: createSignedToken(payload, getAccessTokenSecret()),
    tokenExpiresAt: new Date(expiresAt).toISOString(),
    tokenExpiresInMs: expiresAt - issuedAt,
  };
};

export const verifyAuthToken = (token) =>
  verifySignedToken(token, getAccessTokenSecret(), "access");

export const createRefreshToken = (user, options = {}) => {
  const issuedAt = options.issuedAt || Date.now();
  const expiresAt = options.expiresAt || issuedAt + getSessionDurationForRole(user.role, true);
  const payload = {
    sub: user._id.toString(),
    email: user.email,
    role: user.role,
    exp: expiresAt,
    iat: issuedAt,
    typ: "refresh",
  };

  return {
    token: createSignedToken(payload, getRefreshTokenSecret()),
    tokenExpiresAt: new Date(expiresAt).toISOString(),
    tokenExpiresInMs: expiresAt - issuedAt,
  };
};

export const verifyRefreshToken = (token) =>
  verifySignedToken(token, getRefreshTokenSecret(), "refresh");

export const hashSessionToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

export const pruneExpiredSessions = (sessions = []) => {
  const now = Date.now();
  return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
};

export const parseCookies = (cookieHeader = "") =>
  String(cookieHeader)
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();

      if (!key) {
        return cookies;
      }

      return {
        ...cookies,
        [key]: decodeURIComponent(value),
      };
    }, {});

export const getRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[REFRESH_TOKEN_COOKIE_NAME] || null;
};

export const getRefreshCookieOptions = (expiresAt) => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    expires: expiresAt,
    httpOnly: true,
    path: "/api/auth",
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
  };
};

export const clearRefreshTokenCookie = (res) => {
  res.clearCookie(
    REFRESH_TOKEN_COOKIE_NAME,
    getRefreshCookieOptions(new Date(0)),
  );
};
