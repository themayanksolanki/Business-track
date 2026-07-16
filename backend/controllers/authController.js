import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Invite from '../models/Invite.js';
import AppError from '../utils/AppError.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { cloudinary } from '../middleware/upload.js';

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
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  profileImage: user.profileImage ?? null,
  organization:
    user.organization && user.organization.name
      ? { id: user.organization._id, name: user.organization.name, emailDomain: user.organization.emailDomain }
      : user.organization ?? null,
});

export const register = async (req, res, next) => {
  try {
    const { username, email, password, role, referenceEmail } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) return next(new AppError('Email already registered', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    // An Admin/Manager/Team Lead may have already invited this email into an
    // organization — if so, the invite (not the submitted role/reference)
    // decides role, org, and reporting lines, and the account is active
    // immediately since the invite itself was the approval step.
    const invite = await Invite.findOne({ email: normalizedEmail, status: 'pending' });

    if (invite) {
      const user = await User.create({
        username: username.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: invite.role,
        organization: invite.organization,
        isActive: true,
        managerId: invite.managerId ?? null,
        teamLeadId: invite.teamLeadId ?? null,
        departments: invite.departments ?? [],
      });

      invite.status = 'accepted';
      await invite.save();
      await user.populate('organization', 'name emailDomain');

      const accessToken = generateAccessToken(user._id);
      const refreshToken = generateRefreshToken(user._id);

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
    const domainOrg = await Organization.findOne({ emailDomain });
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
      const refUser = await User.findOne({ email: referenceEmail.toLowerCase().trim() });

      if (!refUser) return next(new AppError('No user found with that email', 404));
      if (refUser.role !== expectedRole)
        return next(new AppError(`That email does not belong to a ${expectedRole}`, 400));

      if (role === 'Team Lead') managerId = refUser._id;
      if (role === 'User') {
        teamLeadId = refUser._id;
        managerId = refUser.managerId ?? null;
      }
    }

    const user = await User.create({
      username: username.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role,
      isActive,
      managerId,
      teamLeadId,
    });

    if (!isActive) {
      const label = role === 'Team Lead' ? 'Manager' : 'Team Lead';
      return res.status(201).json({
        message: `Account created. Your ${label} will activate your account.`,
        pending: true,
      });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) return next(new AppError('Email already registered', 409));

    const existingOrgName = await Organization.findOne({ name: organizationName.trim() });
    if (existingOrgName) return next(new AppError('Organization name already taken', 409));

    const existingDomain = await Organization.findOne({ emailDomain: normalizedDomain });
    if (existingDomain) return next(new AppError('Organization email domain already registered', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username: username.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'Admin',
      organization: null,
      isActive: true,
    });

    let organization;
    try {
      organization = await Organization.create({
        name: organizationName.trim(),
        emailDomain: normalizedDomain,
        createdBy: user._id,
      });
    } catch (err) {
      await User.findByIdAndDelete(user._id);
      throw err;
    }

    user.organization = organization._id;
    await user.save();

    const foundingInvites = [];
    if (normalizedManagerEmail)
      foundingInvites.push({ organization: organization._id, email: normalizedManagerEmail, role: 'Manager', invitedBy: user._id });
    if (normalizedTeamLeadEmail)
      foundingInvites.push({ organization: organization._id, email: normalizedTeamLeadEmail, role: 'Team Lead', invitedBy: user._id });

    if (foundingInvites.length) await Invite.create(foundingInvites);

    await user.populate('organization', 'name emailDomain');

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      message: 'Organization registered successfully',
      token: accessToken,
      refreshToken,
      user: toUserShape(user),
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() }).populate(
      'organization',
      'name emailDomain'
    );
    if (!user) return next(new AppError('Invalid email or password', 401));

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return next(new AppError('Invalid email or password', 401));

    if (!user.isActive)
      return next(new AppError('Account not yet activated. Please ask your manager or team lead.', 403));

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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
    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('organization', 'name emailDomain');

    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account not activated', 403));

    const accessToken = generateAccessToken(user._id);

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
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('managerId', 'username email')
      .populate('teamLeadId', 'username email')
      .populate('organization', 'name emailDomain');

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

export const updateAvatar = async (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No file uploaded', 400));

    const user = await User.findById(req.user._id);

    if (user.profileImage) {
      const publicId = getPublicId(user.profileImage);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    user.profileImage = req.file.path; // Cloudinary secure URL
    await user.save();

    res.status(200).json({ message: 'Avatar updated', user: toUserShape(user) });
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(new AppError('Email is required', 400));

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return next(new AppError('No account found with that email', 404));

    const otp = crypto.randomInt(100000, 999999).toString();
    user.resetOtp = otp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

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

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.resetOtp)
      return next(new AppError('Invalid or expired OTP', 400));

    if (user.resetOtpExpiry < new Date())
      return next(new AppError('OTP has expired. Please request a new one.', 400));

    if (user.resetOtp !== otp.toString())
      return next(new AppError('Incorrect OTP', 400));

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
};

export const removeAvatar = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.profileImage) {
      const publicId = getPublicId(user.profileImage);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
      user.profileImage = null;
      await user.save();
    }

    res.status(200).json({ message: 'Avatar removed', user: toUserShape(user) });
  } catch (err) {
    next(err);
  }
};
