import User from "../models/User.js";
import { createAuthToken, hashPassword, verifyPassword } from "../utils/auth.js";

const validRoles = new Set(["customer", "staff", "admin"]);
const validCustomerTypes = new Set(["personal", "business"]);

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  customerType: user.customerType,
  createdAt: user.createdAt,
});

export const signup = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role = "customer",
      customerType = "personal",
    } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "Name, email, phone, and password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }

    const normalizedRole = String(role).toLowerCase();
    const normalizedCustomerType = String(customerType).toLowerCase();

    if (!validRoles.has(normalizedRole)) {
      return res.status(400).json({ message: "Invalid account role." });
    }

    if (!validCustomerTypes.has(normalizedCustomerType)) {
      return res.status(400).json({ message: "Invalid customer type." });
    }

    const existingUser = await User.findOne({ email: String(email).toLowerCase().trim() });

    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
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
    return res.status(500).json({ message: error.message || "Unable to create account." });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (role && user.role !== String(role).toLowerCase()) {
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
