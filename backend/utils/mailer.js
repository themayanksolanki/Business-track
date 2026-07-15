import nodemailer from 'nodemailer';

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASS,
      },
    });
  }
  return _transporter;
}

export async function sendOtpEmail(to, username, otp) {
  await getTransporter().sendMail({
    from: `"TaskFlow" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Your TaskFlow password reset OTP',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin-bottom:8px;">Password Reset</h2>
        <p style="color:#475569;">Hi <strong>${username}</strong>,</p>
        <p style="color:#475569;">Use the OTP below to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
          <span style="font-size:2.2rem;font-weight:800;color:#1e293b;letter-spacing:0.3em;font-family:monospace;">${otp}</span>
        </div>
        <p style="color:#64748b;font-size:0.875rem;">If you did not request this, ignore this email — your password will not change.</p>
      </div>
    `,
  });
}

export async function sendPasswordChangedEmail(to, username, newPassword) {
  await getTransporter().sendMail({
    from: `"TaskFlow" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Your TaskFlow password has been changed',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin-bottom:8px;">Password Updated</h2>
        <p style="color:#475569;">Hi <strong>${username}</strong>,</p>
        <p style="color:#475569;">Your TaskFlow account password was reset by an administrator.</p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <span style="font-size:0.8rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">New Password</span>
          <div style="font-size:1.1rem;font-weight:700;color:#1e293b;margin-top:4px;font-family:monospace;">${newPassword}</div>
        </div>
        <p style="color:#64748b;font-size:0.875rem;">Please log in and update your password from your profile settings.</p>
        <p style="color:#94a3b8;font-size:0.75rem;margin-top:24px;">If you did not request this change, contact your administrator immediately.</p>
      </div>
    `,
  });
}
