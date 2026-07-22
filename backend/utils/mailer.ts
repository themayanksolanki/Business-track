import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
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

async function dispatch(mailOptions: SendMailOptions): Promise<void> {
  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[mailer] SKIP_EMAIL is set — skipping "${mailOptions.subject}" to ${mailOptions.to}`);
    return;
  }
  await getTransporter().sendMail(mailOptions);
}

export async function sendOtpEmail(to: string, username: string, otp: string): Promise<void> {
  await dispatch({
    from: `"Business Tracker" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Your Business Tracker password reset OTP',
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

export async function sendInviteEmail(to: string, role: string, orgName: string, inviteLink: string): Promise<void> {
  await dispatch({
    from: `"Business Tracker" <${process.env.GMAIL_USER}>`,
    to,
    subject: `You've been invited to join ${orgName} on Business Tracker`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin-bottom:8px;">You're Invited</h2>
        <p style="color:#475569;">You've been invited to join <strong>${orgName}</strong> on Business Tracker as a <strong>${role}</strong>.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${inviteLink}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;display:inline-block;">Accept Invite &amp; Create Password</a>
        </div>
        <p style="color:#64748b;font-size:0.875rem;">This link expires in 7 days. If you weren't expecting this invite, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordChangedEmail(to: string, username: string, newPassword: string): Promise<void> {
  await dispatch({
    from: `"Business Tracker" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Your Business Tracker password has been changed',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin-bottom:8px;">Password Updated</h2>
        <p style="color:#475569;">Hi <strong>${username}</strong>,</p>
        <p style="color:#475569;">Your Business Tracker account password was reset by an administrator.</p>
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
