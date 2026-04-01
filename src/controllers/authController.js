import User from "../models/User.js";
import { createAuthToken, hashPassword, verifyPassword } from "../utils/auth.js";

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

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  customerType: user.customerType,
  createdAt: user.createdAt,
});

const normalizeEnumValue = (value, aliases) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return aliases.get(String(value).toLowerCase().trim()) || null;
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

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: hashPassword(password),
      role: normalizedRole,
      customerType: normalizedCustomerType,
    });

    const token = createAuthToken(user);

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: serializeUser(user),
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
    const { email, password, role } = req.body;
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

    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({ message: `This account is not registered as a ${role}.` });
    }

    const token = createAuthToken(user);

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: serializeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to sign in." });
  }
};

export const me = async (req, res) => {
  return res.status(200).json({ user: serializeUser(req.user) });
};
