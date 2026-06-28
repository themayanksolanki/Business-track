import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
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

export const register = async (req, res, next) => {
  try {
    const { username, email, password, role, referenceEmail } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return next(new AppError('Email already registered', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

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
      if (role === 'Employee') {
        teamLeadId = refUser._id;
        managerId = refUser.managerId ?? null;
      }
    }

    const user = await User.create({
      username: username.trim(),
      email,
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
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
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
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return next(new AppError('No refresh token', 401));

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account not activated', 403));

    const accessToken = generateAccessToken(user._id);

    res.status(200).json({
      token: accessToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
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
      .populate('teamLeadId', 'username email');

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};
