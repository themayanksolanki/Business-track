import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { cloudinary } from '../middleware/upload.js';
import { ensureDefaultProjectRoles } from './projectRoleController.js';
import { nextSequenceId } from '../utils/sequence.js';
const ORG_SELECT = { id: true, name: true, emailDomain: true };
// Extract Cloudinary public_id from a secure URL for deletion
const getPublicId = (url) => {
    const match = url?.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
    return match?.[1] ?? null;
};
const isProd = process.env.NODE_ENV === 'production';
export const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'strict', // 'none' required for cross-origin cookies in production
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};
export const generateAccessToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
});
export const generateRefreshToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
});
export const toUserShape = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    profileImage: user.profileImage ?? null,
    phoneCountry: user.phoneCountry ?? null,
    phoneNumber: user.phoneNumber ?? null,
    dateFormat: user.dateFormat,
    timeFormat: user.timeFormat,
    defaultLandingPage: user.defaultLandingPage,
    sidebarTheme: user.sidebarTheme,
    sidebarTextColor: user.sidebarTextColor ?? null,
    organization: user.organization
        ? { id: user.organization.id, name: user.organization.name, emailDomain: user.organization.emailDomain }
        : null,
});
export const registerOrganization = async (req, res, next) => {
    try {
        const { username, email, password, organizationName, emailDomain } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        const normalizedDomain = emailDomain.toLowerCase().trim();
        if (normalizedEmail.split('@')[1] !== normalizedDomain)
            return next(new AppError('Your email domain must match the organization email domain', 400));
        const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existingUser)
            return next(new AppError('Email already registered', 409));
        const existingOrgName = await prisma.organization.findUnique({
            where: { name: organizationName.trim() },
        });
        if (existingOrgName)
            return next(new AppError('Organization name already taken', 409));
        const existingDomain = await prisma.organization.findUnique({ where: { emailDomain: normalizedDomain } });
        if (existingDomain)
            return next(new AppError('Organization email domain already registered', 409));
        const hashedPassword = await bcrypt.hash(password, 10);
        // User and organization are chicken-and-egg (the user needs an org id,
        // the org needs a createdById) — a single transaction replaces the old
        // manual "delete the user if org creation fails" compensation with a
        // real rollback, and lets the founding user's sequenceId (always 1,
        // since it's a brand-new org) come from the same atomic counter path
        // every other user creation uses.
        const { user, organization, updatedUser } = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    username: username.trim(),
                    email: normalizedEmail,
                    password: hashedPassword,
                    role: 'Admin',
                    isActive: true,
                },
            });
            const organization = await tx.organization.create({
                data: {
                    name: organizationName.trim(),
                    emailDomain: normalizedDomain,
                    createdById: user.id,
                },
            });
            const sequenceId = await nextSequenceId(tx, organization.id, 'user');
            const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: { organizationId: organization.id, sequenceId },
                include: { organization: { select: ORG_SELECT } },
            });
            return { user, organization, updatedUser };
        });
        await ensureDefaultProjectRoles(organization.id, user.id);
        const accessToken = generateAccessToken(updatedUser.id);
        const refreshToken = generateRefreshToken(updatedUser.id);
        res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
        res.status(201).json({
            message: 'Organization registered successfully',
            token: accessToken,
            refreshToken,
            user: toUserShape(updatedUser),
        });
    }
    catch (err) {
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
        if (!user)
            return next(new AppError('Invalid email or password', 401));
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return next(new AppError('Invalid email or password', 401));
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
    }
    catch (err) {
        next(err);
    }
};
export const refresh = async (req, res, next) => {
    try {
        // Prefer the httpOnly cookie (same-site deployments); fall back to a
        // client-stored refresh token (needed cross-site, since mobile Safari/
        // Chrome block third-party cookies regardless of SameSite=None).
        const token = req.cookies.refreshToken || req.body?.refreshToken;
        if (!token)
            return next(new AppError('No refresh token', 401));
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const user = await prisma.user.findUnique({
            where: { id: Number(decoded.id) },
            include: { organization: { select: ORG_SELECT } },
        });
        if (!user)
            return next(new AppError('User not found', 401));
        if (!user.isActive)
            return next(new AppError('Account not activated', 403));
        const accessToken = generateAccessToken(user.id);
        res.status(200).json({
            token: accessToken,
            user: toUserShape(user),
        });
    }
    catch {
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
    }
    catch (err) {
        next(err);
    }
};
export const updateAvatar = async (req, res, next) => {
    try {
        if (!req.file)
            return next(new AppError('No file uploaded', 400));
        const existing = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { profileImage: true },
        });
        if (existing?.profileImage) {
            const publicId = getPublicId(existing.profileImage);
            if (publicId)
                await cloudinary.uploader.destroy(publicId).catch(() => { });
        }
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { profileImage: req.file.path }, // Cloudinary secure URL
            include: { organization: { select: ORG_SELECT } },
        });
        res.status(200).json({ message: 'Avatar updated', user: toUserShape(user) });
    }
    catch (err) {
        next(err);
    }
};
export const updateProfile = async (req, res, next) => {
    try {
        const { phoneCountry, phoneNumber, dateFormat, timeFormat, defaultLandingPage, sidebarTheme, sidebarTextColor } = req.body;
        // Partial update — this endpoint is shared by the Profile page's phone
        // editor and Settings > General's date/time-format/landing-page pickers,
        // so a request from one must not clobber fields the others own (e.g.
        // saving just dateFormat shouldn't null out an already-saved phone number).
        const data = {};
        if (phoneCountry !== undefined)
            data.phoneCountry = phoneCountry || null;
        if (phoneNumber !== undefined)
            data.phoneNumber = phoneNumber || null;
        if (dateFormat !== undefined)
            data.dateFormat = dateFormat;
        if (timeFormat !== undefined)
            data.timeFormat = timeFormat;
        if (defaultLandingPage !== undefined)
            data.defaultLandingPage = defaultLandingPage;
        if (sidebarTheme !== undefined)
            data.sidebarTheme = sidebarTheme;
        if (sidebarTextColor !== undefined)
            data.sidebarTextColor = sidebarTextColor || null;
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data,
            include: { organization: { select: ORG_SELECT } },
        });
        res.status(200).json({ message: 'Profile updated', user: toUserShape(user) });
    }
    catch (err) {
        next(err);
    }
};
export const forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email)
            return next(new AppError('Email is required', 400));
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user)
            return next(new AppError('No account found with that email', 404));
        const otp = crypto.randomInt(100000, 999999).toString();
        await prisma.user.update({
            where: { id: user.id },
            data: { resetOtp: otp, resetOtpExpiry: new Date(Date.now() + 10 * 60 * 1000) },
        });
        await sendOtpEmail(user.email, user.username, otp);
        res.status(200).json({ message: 'OTP sent to your email' });
    }
    catch (err) {
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
        if (!user || !user.resetOtp)
            return next(new AppError('Invalid or expired OTP', 400));
        if (!user.resetOtpExpiry || user.resetOtpExpiry < new Date())
            return next(new AppError('OTP has expired. Please request a new one.', 400));
        if (user.resetOtp !== otp.toString())
            return next(new AppError('Incorrect OTP', 400));
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: await bcrypt.hash(newPassword, 10),
                resetOtp: null,
                resetOtpExpiry: null,
            },
        });
        res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
    }
    catch (err) {
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
        if (existing?.profileImage) {
            const publicId = getPublicId(existing.profileImage);
            if (publicId)
                await cloudinary.uploader.destroy(publicId).catch(() => { });
            user = await prisma.user.update({
                where: { id: req.user.id },
                data: { profileImage: null },
                include: { organization: { select: ORG_SELECT } },
            });
        }
        else {
            user = await prisma.user.findUnique({
                where: { id: req.user.id },
                include: { organization: { select: ORG_SELECT } },
            });
        }
        res.status(200).json({ message: 'Avatar removed', user: toUserShape(user) });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=authController.js.map