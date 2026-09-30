import nodemailer from 'nodemailer';

/**
 * Creates nodemailer transport if SMTP_HOST is configured, otherwise returns null for console fallback.
 */
export function createTransport() {
  const host = process.env.SMTP_HOST;
  if (!host || !host.trim()) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const auth = (user && pass) ? { user, pass } : undefined;

  return nodemailer.createTransport({
    host: host.trim(),
    port,
    secure: port === 465,
    auth
  });
}

let activeTransport = null;

export function getTransport() {
  if (activeTransport === null) {
    activeTransport = createTransport();
  }
  return activeTransport;
}

/**
 * Overrides transport for testing.
 */
export function setTransport(transport) {
  activeTransport = transport;
}

/**
 * Sends an OTP email to the given recipient.
 * When SMTP_HOST is empty, logs to console in the format:
 * `[OTP-DEV] Code 482910 for voter@example.com, expires in 10 min`
 *
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ success: boolean, mode: 'smtp'|'console', error?: string }>}
 */
export async function sendOtpEmail(email, code) {
  const ttlMinutes = parseInt(process.env.OTP_TTL_MINUTES, 10) || 10;
  const transport = getTransport();

  if (!transport) {
    console.log(`[OTP-DEV] Code ${code} for ${email}, expires in ${ttlMinutes} min`);
    return {
      success: true,
      mode: 'console'
    };
  }

  const mailFrom = process.env.MAIL_FROM || 'VoteSphere <noreply@votesphere.local>';
  const mailOptions = {
    from: mailFrom,
    to: email,
    subject: 'Your VoteSphere Verification Code',
    text: `Your VoteSphere verification code is: ${code}\n\nThis code expires in ${ttlMinutes} minutes. If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">VoteSphere Verification</h2>
        <p>Use the following 6-digit code to complete your verification:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b; background: #f1f5f9; padding: 16px; text-align: center; border-radius: 6px; margin: 24px 0;">
          ${code}
        </div>
        <p style="color: #64748b; font-size: 14px;">This code expires in ${ttlMinutes} minutes.</p>
        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">If you did not request this code, no action is needed.</p>
      </div>
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return {
      success: true,
      mode: 'smtp'
    };
  } catch (err) {
    console.error('[Email] Failed to send OTP email via SMTP:', err.message);
    // Even if SMTP fails, do not expose internal error or code in HTTP responses
    return {
      success: false,
      mode: 'smtp',
      error: err.message
    };
  }
}
