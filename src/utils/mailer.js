// src/utils/mailer.js
const sgMail = require('@sendgrid/mail');

const FROM = process.env.SENDGRID_FROM || 'no-reply@example.com';
const APP_NAME = process.env.APP_NAME || 'AGMULA';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('[WARN] SENDGRID_API_KEY not set — emails will be skipped.');
}

async function sendOtpEmail(to, otp) {
  if (!process.env.SENDGRID_API_KEY) return { skipped: true };

  const msg = {
    to,
    from: FROM,
    subject: `${APP_NAME} password reset code`,
    text: `Your OTP code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <h2>${APP_NAME} Password Reset</h2>
        <p>Use this one-time code to reset your password:</p>
        <p style="font-size:28px;letter-spacing:4px;margin:16px 0;"><b>${otp}</b></p>
        <p>This code expires in <b>10 minutes</b>.</p>
        <p>If you didn’t request this, you can ignore this email.</p>
      </div>
    `,
  };

  await sgMail.send(msg);
  return { sent: true };
}

module.exports = { sendOtpEmail };
