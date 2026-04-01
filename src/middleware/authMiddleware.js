import User from "../models/User.js";
import { verifyAuthToken } from "../utils/auth.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Authentication token is required." });
    }

    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub).select("-passwordHash");

    if (!user) {
      return res.status(401).json({ message: "Authenticated user no longer exists." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: error.message || "Invalid authentication token." });
  }
};
