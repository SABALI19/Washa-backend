import nodemailer from "nodemailer";

let cachedTransporter = null;

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase().trim());
};

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const fromAddress = String(process.env.SMTP_FROM || user).trim();
  const fromName = String(process.env.SMTP_FROM_NAME || "Washa").trim();
  const enabled = parseBoolean(process.env.SMTP_NOTIFICATIONS_ENABLED, Boolean(host && fromAddress));

  return {
    enabled,
    from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
    host,
    pass,
    port: Number.isFinite(port) ? port : 587,
    secure: parseBoolean(process.env.SMTP_SECURE, port === 465),
    user,
  };
};

const getTransporter = () => {
  const config = getSmtpConfig();

  if (!config.enabled || !config.host || !config.from) {
    return null;
  }

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      auth:
        config.user && config.pass
          ? {
              pass: config.pass,
              user: config.user,
            }
          : undefined,
      host: config.host,
      port: config.port,
      secure: config.secure,
    });
  }

  return cachedTransporter;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const buildHtmlMessage = ({ message, title }) => `
  <div style="margin:0;background:#f8fafc;padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:#2c4a7d;color:#ffffff;padding:18px 22px;">
        <h1 style="margin:0;font-size:18px;line-height:1.35;">${escapeHtml(title)}</h1>
      </div>
      <div style="padding:22px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(message)}</p>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">This is an automated Washa notification.</p>
      </div>
    </div>
  </div>
`;

export const sendNotificationEmail = async ({ message, subject, title, to }) => {
  const transporter = getTransporter();
  const config = getSmtpConfig();
  const normalizedTo = String(to || "").trim();
  const normalizedTitle = String(title || subject || "").trim();
  const normalizedMessage = String(message || "").trim();

  if (!transporter || !normalizedTo || !normalizedTitle || !normalizedMessage) {
    return { skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: config.from,
      html: buildHtmlMessage({
        message: normalizedMessage,
        title: normalizedTitle,
      }),
      subject: subject || normalizedTitle,
      text: normalizedMessage,
      to: normalizedTo,
    });

    return { messageId: info.messageId, skipped: false };
  } catch (error) {
    console.warn(`SMTP notification failed: ${error.message}`);
    return { error, skipped: false };
  }
};
