import User from "../models/User.js";
import {
  clearRefreshTokenCookie,
  createAuthToken,
  createRefreshToken,
  getRefreshCookieOptions,
  getRefreshTokenFromRequest,
  getSessionDurationForRole,
  hashPassword,
  hashSessionToken,
  pruneExpiredSessions,
  verifyRefreshToken,
  verifyPassword,
} from "../utils/auth.js";

const roleAliases = new Map([
  ["customer", "customer"],
  ["client", "customer"],
  ["user", "customer"],
  ["staff", "staff"],
  ["employee", "staff"],
  ["admin", "admin"],
]);

const customerTypeAliases = new Map([
  ["personal", "personal"],
  ["individual", "personal"],
  ["business", "business"],
  ["commercial", "business"],
  ["corporate", "business"],
]);

const HARDCODED_ROLE_BY_EMAIL = new Map([
  ["elsabalii007@gmail.com", "admin"],
  ["noxasup@gmail.com", "staff"],
]);

const PRIVILEGED_ROLES = new Set(["admin", "staff"]);

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  profileImage: user.profileImage || "",
  role: user.role,
  customerType: user.customerType,
  createdAt: user.createdAt,
});

const normalizeProfileImage = (value) => String(value || "").trim();

const isSupportedProfileImage = (value) =>
  !value || /^data:image\/(png|jpe?g|webp);base64,/i.test(value);

const normalizeEnumValue = (value, aliases) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return aliases.get(String(value).toLowerCase().trim()) || null;
};

const getHardcodedRoleForEmail = (email) =>
  HARDCODED_ROLE_BY_EMAIL.get(String(email || "").toLowerCase().trim()) || null;

const resolveAllowedRoleForEmail = (email, requestedRole) => {
  const hardcodedRole = getHardcodedRoleForEmail(email);

  if (hardcodedRole) {
    return { role: hardcodedRole };
  }

  if (requestedRole && PRIVILEGED_ROLES.has(requestedRole)) {
    return {
      errorMessage: "This email is not authorized for staff or admin access.",
    };
  }

  return {
    role: requestedRole || "customer",
  };
};

const syncRestrictedRoleForUser = async (user) => {
  const hardcodedRole = getHardcodedRoleForEmail(user.email);

  if (hardcodedRole) {
    if (user.role !== hardcodedRole) {
      user.role = hardcodedRole;
      await user.save();
    }

    return hardcodedRole;
  }

  if (PRIVILEGED_ROLES.has(user.role)) {
    user.role = "customer";
    await user.save();
  }

  return user.role;
};

const getSessionPolicyLabel = (role, rememberMe) => {
  if (role === "admin") {
    return "8-hour admin session";
  }

  if (role === "staff") {
    return "24-hour staff session";
  }

  if (!rememberMe) {
    return "24-hour customer session";
  }

  return "2-week customer session";
};

const getRequestUserAgent = (req) => String(req.headers["user-agent"] || "").slice(0, 300);

const issueAuthSession = async (res, user, options = {}) => {
  const rememberMe = user.role === "customer" ? options.rememberMe !== false : true;
  const durationMs = getSessionDurationForRole(user.role, rememberMe);
  const now = Date.now();
  const sessionExpiresAt = new Date(now + durationMs);
  const refreshTokenPayload = createRefreshToken(user, {
    expiresAt: sessionExpiresAt.getTime(),
    issuedAt: now,
  });
  const refreshToken = refreshTokenPayload.token;
  const refreshTokenHash = hashSessionToken(refreshToken);

  user.authSessions = pruneExpiredSessions(user.authSessions || []);
  user.authSessions.push({
    createdAt: new Date(now),
    expiresAt: sessionExpiresAt,
    lastUsedAt: new Date(now),
    rememberMe,
    tokenHash: refreshTokenHash,
    userAgent: getRequestUserAgent(options.req),
  });
  await user.save();

  const accessToken = createAuthToken(user, {
    issuedAt: now,
    sessionExpiresAt: sessionExpiresAt.getTime(),
  });

  res.cookie(
    "washa_refresh_token",
    refreshToken,
    getRefreshCookieOptions(sessionExpiresAt),
  );

  return {
    ...accessToken,
    session: {
      durationMs,
      expiresAt: sessionExpiresAt.toISOString(),
      issuedAt: new Date(now).toISOString(),
      policy: getSessionPolicyLabel(user.role, rememberMe),
      rememberMe,
    },
    user: serializeUser(user),
  };
};

const removeRefreshSession = async (refreshToken) => {
  if (!refreshToken) {
    return;
  }

  const refreshTokenHash = hashSessionToken(refreshToken);

  await User.updateOne(
    { "authSessions.tokenHash": refreshTokenHash },
    {
      $pull: {
        authSessions: { tokenHash: refreshTokenHash },
      },
    },
  );
};

export const signup = async (req, res) => {
  try {
    const {
      name,
      fullName,
      email,
      phone,
      phoneNumber,
      password,
      role = "customer",
      customerType = "personal",
      rememberMe = true,
    } = req.body;

    const normalizedName = String(name || fullName || "").trim();
    const normalizedEmail = String(email || "").toLowerCase().trim();
    const normalizedPhone = String(phone || phoneNumber || "").trim();

    if (!normalizedName || !normalizedEmail || !normalizedPhone || !password) {
      return res.status(400).json({ message: "Name, email, phone, and password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }

    const normalizedRole = normalizeEnumValue(role, roleAliases);
    const normalizedCustomerType = normalizeEnumValue(customerType, customerTypeAliases);

    if (!normalizedRole) {
      return res.status(400).json({ message: "Invalid account role." });
    }

    if (!normalizedCustomerType) {
      return res.status(400).json({ message: "Invalid customer type." });
    }

    const allowedRole = resolveAllowedRoleForEmail(normalizedEmail, normalizedRole);

    if (allowedRole.errorMessage) {
      return res.status(403).json({ message: allowedRole.errorMessage });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: hashPassword(password),
      role: allowedRole.role,
      customerType: normalizedCustomerType,
    });

    const sessionPayload = await issueAuthSession(res, user, {
      rememberMe,
      req,
    });

    return res.status(201).json({
      message: "Account created successfully.",
      ...sessionPayload,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    return res.status(500).json({ message: error.message || "Unable to create account." });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, role, rememberMe = true } = req.body;
    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const requestedRole = normalizeEnumValue(role, roleAliases);

    if (role && !requestedRole) {
      return res.status(400).json({ message: "Invalid account role." });
    }

    const allowedRole = resolveAllowedRoleForEmail(normalizedEmail, requestedRole);

    if (allowedRole.errorMessage) {
      return res.status(403).json({ message: allowedRole.errorMessage });
    }

    const effectiveUserRole = await syncRestrictedRoleForUser(user);

    if (effectiveUserRole !== allowedRole.role) {
      return res
        .status(403)
        .json({ message: `This account is not registered as a ${allowedRole.role}.` });
    }

    const sessionPayload = await issueAuthSession(res, user, {
      rememberMe,
      req,
    });

    return res.status(200).json({
      message: "Login successful.",
      ...sessionPayload,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to sign in." });
  }
};

export const refresh = async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);

    if (!refreshToken) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ message: "Refresh token is required." });
    }

    const refreshPayload = verifyRefreshToken(refreshToken);
    const refreshTokenHash = hashSessionToken(refreshToken);
    const user = await User.findOne({
      _id: refreshPayload.sub,
      "authSessions.tokenHash": refreshTokenHash,
    });

    if (!user) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ message: "Refresh session is invalid." });
    }

    user.authSessions = pruneExpiredSessions(user.authSessions || []);
    const existingSession = user.authSessions.find((session) => session.tokenHash === refreshTokenHash);

    if (!existingSession) {
      await user.save();
      clearRefreshTokenCookie(res);
      return res.status(401).json({ message: "Refresh session has expired." });
    }

    const now = Date.now();
    const rotatedRefreshTokenPayload = createRefreshToken(user, {
      expiresAt: new Date(existingSession.expiresAt).getTime(),
      issuedAt: now,
    });
    existingSession.tokenHash = hashSessionToken(rotatedRefreshTokenPayload.token);
    existingSession.lastUsedAt = new Date(now);
    existingSession.userAgent = getRequestUserAgent(req);
    await user.save();

    const accessToken = createAuthToken(user, {
      issuedAt: now,
      sessionExpiresAt: new Date(existingSession.expiresAt).getTime(),
    });

    res.cookie(
      "washa_refresh_token",
      rotatedRefreshTokenPayload.token,
      getRefreshCookieOptions(existingSession.expiresAt),
    );

    return res.status(200).json({
      message: "Session refreshed.",
      ...accessToken,
      session: {
        durationMs: new Date(existingSession.expiresAt).getTime() - now,
        expiresAt: new Date(existingSession.expiresAt).toISOString(),
        issuedAt: new Date(now).toISOString(),
        policy: getSessionPolicyLabel(user.role, existingSession.rememberMe !== false),
        rememberMe: existingSession.rememberMe !== false,
      },
      user: serializeUser(user),
    });
  } catch (error) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ message: error.message || "Unable to refresh session." });
  }
};

export const logout = async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    await removeRefreshSession(refreshToken);
    clearRefreshTokenCookie(res);
    return res.status(200).json({ message: "Logout successful." });
  } catch (error) {
    clearRefreshTokenCookie(res);
    return res.status(500).json({ message: error.message || "Unable to sign out." });
  }
};

export const updateProfileImage = async (req, res) => {
  try {
    const profileImage = normalizeProfileImage(req.body?.profileImage);

    if (!isSupportedProfileImage(profileImage)) {
      return res.status(400).json({
        message: "Profile image must be a PNG, JPG, or WebP image.",
      });
    }

    req.user.profileImage = profileImage;
    await req.user.save();

    return res.status(200).json({
      message: profileImage ? "Profile image updated." : "Profile image removed.",
      user: serializeUser(req.user),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to update profile image.",
    });
  }
};

export const me = async (req, res) => {
  return res.status(200).json({ user: serializeUser(req.user) });
};
