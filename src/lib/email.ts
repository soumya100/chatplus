import nodemailer from "nodemailer"

export type TransactionalEmail = {
  to: string
  subject: string
  html: string
}

export function isEmailConfigured() {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS)
}

export async function sendEmail(message: TransactionalEmail) {
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  const from = process.env.EMAIL_FROM?.trim() || user
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com"
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE.toLowerCase() === "true"
    : port === 465

  if (!user || !pass || !from) {
    throw new Error("SMTP email provider is not configured")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port")
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2" },
  })

  try {
    return await transporter.sendMail({ from, to: message.to, subject: message.subject, html: message.html })
  } finally {
    transporter.close()
  }
}
