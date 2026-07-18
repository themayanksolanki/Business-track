import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { cloudinary } from '../middleware/upload.js';
import { ensureDefaultProjectRoles } from './projectRoleController.js';

const ORG_SELECT = { id: true, name: true, emailDomain: true };

// Extract Cloudinary public_id from a secure URL for deletion
const getPublicId = (url) => {
  const match = url?.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
  return match?.[1] ?? null;
};

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'strict', // 'none' required for cross-origin cookies in production
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });

const toUserShape = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  profileImage: user.profileImage ?? null,
  organization: user.organization
    ? { id: user.organization.id, name: user.organization.name, emailDomain: user.organization.emailDomain }
    : null,
});

export const register = async (req, res, next) => {
  try {
    const { username, email, password, role, referenceEmail } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return next(new AppError('Email already registered', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    // An Admin/Manager/Team Lead may have already invited this email into an
    // organization — if so, the invite (not the submitted role/reference)
    // decides role, org, and reporting lines, and the account is active
    // immediately since the invite itself was the approval step.
    const invite = await prisma.invite.findFirst({
      where: { email: normalizedEmail, status: 'pending' },
      include: { departments: { select: { id: true } } },
    });

    if (invite) {
      const user = await prisma.user.create({
        data: {
          username: username.trim(),
          email: normalizedEmail,
          password: hashedPassword,
          role: invite.role,
          organizationId: invite.organizationId,
          isActive: true,
          managerId: invite.managerId ?? null,
          teamLeadId: invite.teamLeadId ?? null,
          departments: { connect: invite.departments.map((d) => ({ id: d.id })) },
        },
        include: { organization: { select: ORG_SELECT } },
      });

      await prisma.invite.update({ where: { id: invite.id }, data: { status: 'accepted' } });

      const accessToken = generateAccessToken(user.id);
      const refreshToken = generateRefreshToken(user.id);

      res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

      return res.status(201).json({
        message: 'User registered successfully',
        token: accessToken,
        refreshToken,
        user: toUserShape(user),
      });
    }

    // No invite — if this email's domain belongs to an existing organization,
    // membership requires an invite from that org's Admin/Manager/Team Lead.
    const emailDomain = normalizedEmail.split('@')[1];
    const domainOrg = await prisma.organization.findUnique({ where: { emailDomain } });
    if (domainOrg) {
      return next(
        new AppError('This email domain belongs to an organization. Please ask your admin for an invite.', 403)
      );
    }

    let managerId = null;
    let teamLeadId = null;
    let isActive = false;

    if (role === 'Manager') {
      isActive = true;
    } else {
      if (!referenceEmail) {
        const label = role === 'Team Lead' ? 'Manager' : 'Team Lead';
        return next(new AppError(`${label} email is required`, 400));
      }

      const expectedRole = role === 'Team Lead' ? 'Manager' : 'Team Lead';
      const refUser = await prisma.user.findUnique({
        where: { email: referenceEmail.toLowerCase().trim() },
      });

      if (!refUser) return next(new AppError('No user found with that email', 404));
      if (refUser.role !== expectedRole)
        return next(new AppError(`That email does not belong to a ${expectedRole}`, 400));

      if (role === 'Team Lead') managerId = refUser.id;
      if (role === 'User') {
        teamLeadId = refUser.id;
        managerId = refUser.managerId ?? null;
      }
    }

    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role,
        isActive,
        managerId,
        teamLeadId,
      },
    });

    if (!isActive) {
      const label = role === 'Team Lead' ? 'Manager' : 'Team Lead';
      return res.status(201).json({
        message: `Account created. Your ${label} will activate your account.`,
        pending: true,
      });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      message: 'User registered successfully',
      token: accessToken,
      refreshToken,
      user: toUserShape(user),
    });
  } catch (err) {
    next(err);
  }
};

export const registerOrganization = async (req, res, next) => {
  try {
    const { username, email, password, organizationName, emailDomain, managerEmail, teamLeadEmail } = req.body;

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedDomain = emailDomain.toLowerCase().trim();
    const normalizedManagerEmail = managerEmail ? managerEmail.toLowerCase().trim() : null;
    const normalizedTeamLeadEmail = teamLeadEmail ? teamLeadEmail.toLowerCase().trim() : null;

    if (normalizedEmail.split('@')[1] !== normalizedDomain)
      return next(new AppError('Your email domain must match the organization email domain', 400));
    if (normalizedManagerEmail && normalizedManagerEmail.split('@')[1] !== normalizedDomain)
      return next(new AppError('Manager email must belong to the organization email domain', 400));
    if (normalizedTeamLeadEmail && normalizedTeamLeadEmail.split('@')[1] !== normalizedDomain)
      return next(new AppError('Team Lead email must belong to the organization email domain', 400));
    if (normalizedManagerEmail && normalizedManagerEmail === normalizedTeamLeadEmail)
      return next(new AppError('Manager and Team Lead cannot be the same email', 400));

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return next(new AppError('Email already registered', 409));

    const existingOrgName = await prisma.organization.findUnique({
      where: { name: organizationName.trim() },
    });
    if (existingOrgName) return next(new AppError('Organization name already taken', 409));

    const existingDomain = await prisma.organization.findUnique({ where: { emailDomain: normalizedDomain } });
    if (existingDomain) return next(new AppError('Organization email domain already registered', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: 'Admin',
        isActive: true,
      },
    });

    let organization;
    try {
      organization = await prisma.organization.create({
        data: {
          name: organizationName.trim(),
          emailDomain: normalizedDomain,
          createdById: user.id,
        },
      });
    } catch (err) {
      await prisma.user.delete({ where: { id: user.id } });
      throw err;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: organization.id },
      include: { organization: { select: ORG_SELECT } },
    });

    await ensureDefaultProjectRoles(organization.id, user.id);

    const foundingInvites = [];
    if (normalizedManagerEmail)
      foundingInvites.push({
        organizationId: organization.id,
        email: normalizedManagerEmail,
        role: 'Manager',
        invitedById: user.id,
      });
    if (normalizedTeamLeadEmail)
      foundingInvites.push({
        organizationId: organization.id,
        email: normalizedTeamLeadEmail,
        role: 'Team Lead',
        invitedById: user.id,
      });

    if (foundingInvites.length) await prisma.invite.createMany({ data: foundingInvites });

    const accessToken = generateAccessToken(updatedUser.id);
    const refreshToken = generateRefreshToken(updatedUser.id);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      message: 'Organization registered successfully',
      token: accessToken,
      refreshToken,
      user: toUserShape(updatedUser),
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: { select: ORG_SELECT } },
    });
    if (!user) return next(new AppError('Invalid email or password', 401));

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return next(new AppError('Invalid email or password', 401));

    if (!user.isActive)
      return next(new AppError('Account not yet activated. Please ask your manager or team lead.', 403));

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(200).json({
      message: 'Login successful',
      token: accessToken,
      refreshToken,
      user: toUserShape(user),
    });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req, res, next) => {
  try {
    // Prefer the httpOnly cookie (same-site deployments); fall back to a
    // client-stored refresh token (needed cross-site, since mobile Safari/
    // Chrome block third-party cookies regardless of SameSite=None).
    const token = req.cookies.refreshToken || req.body?.refreshToken;
    if (!token) return next(new AppError('No refresh token', 401));

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: Number(decoded.id) },
      include: { organization: { select: ORG_SELECT } },
    });

    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account not activated', 403));

    const accessToken = generateAccessToken(user.id);

    res.status(200).json({
      token: accessToken,
      user: toUserShape(user),
    });
  } catch {
    next(new AppError('Invalid or expired refresh token', 401));
  }
};

export const logout = (_req, res) => {
  res.clearCookie('refreshToken', { ...COOKIE_OPTIONS, maxAge: 0 });
  res.status(200).json({ message: 'Logged out' });
};

export const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      omit: { password: true },
      include: {
        manager: { select: { id: true, username: true, email: true } },
        teamLead: { select: { id: true, username: true, email: true } },
        organization: { select: ORG_SELECT },
      },
    });

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

export const updateAvatar = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file uploaded', 400));

    const existing = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { profileImage: true },
    });

    if (existing.profileImage) {
      const publicId = getPublicId(existing.profileImage);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { profileImage: req.file.path }, // Cloudinary secure URL
      include: { organization: { select: ORG_SELECT } },
    });

    res.status(200).json({ message: 'Avatar updated', user: toUserShape(user) });
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(new AppError('Email is required', 400));

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return next(new AppError('No account found with that email', 404));

    const otp = crypto.randomInt(100000, 999999).toString();
    await prisma.user.update({
      where: { id: user.id },
      data: { resetOtp: otp, resetOtpExpiry: new Date(Date.now() + 10 * 60 * 1000) },
    });

    await sendOtpEmail(user.email, user.username, otp);

    res.status(200).json({ message: 'OTP sent to your email' });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return next(new AppError('Email, OTP, and new password are required', 400));
    if (newPassword.length < 6)
      return next(new AppError('Password must be at least 6 characters', 400));

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.resetOtp) return next(new AppError('Invalid or expired OTP', 400));

    if (user.resetOtpExpiry < new Date())
      return next(new AppError('OTP has expired. Please request a new one.', 400));

    if (user.resetOtp !== otp.toString()) return next(new AppError('Incorrect OTP', 400));

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        resetOtp: null,
        resetOtpExpiry: null,
      },
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
};

export const removeAvatar = async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { profileImage: true },
    });

    let user;
    if (existing.profileImage) {
      const publicId = getPublicId(existing.profileImage);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
      user = await prisma.user.update({
        where: { id: req.user.id },
        data: { profileImage: null },
        include: { organization: { select: ORG_SELECT } },
      });
    } else {
      user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { organization: { select: ORG_SELECT } },
      });
    }

    res.status(200).json({ message: 'Avatar removed', user: toUserShape(user) });
  } catch (err) {
    next(err);
  }
};
