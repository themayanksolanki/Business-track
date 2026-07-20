import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import tagRoutes from './routes/tagRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import projectRoleRoutes from './routes/projectRoleRoutes.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import { authLimiter, globalLimiter } from './utils/utils.js';
import { setupSocket } from './socket.js';
import { startAttachmentSweeper } from './jobs/attachmentSweeper.js';

const app = express();
const server = createServer(app);
setupSocket(server);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:4200')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Tracked via connection events rather than an active ping on every request —
// Postgres is now the database every route depends on; Mongo is kept
// connected for future use but nothing reads/writes it yet.
let postgresConnected = false;

// Lightweight liveness check — kept ahead of body parsing/auth so it always
// responds fast regardless of DB state; an external monitor pings this on an
// interval shorter than Render free tier's 15-minute idle timeout to keep
// the instance from spinning down.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    dbConnected: postgresConnected,
    mongoConnected: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString(),
  });
});

// app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

//authLimiter
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/project-roles', projectRoleRoutes);

app.use(errorMiddleware);

async function start() {
  try {
    await prisma.$connect();
    postgresConnected = true;
    console.log('Postgres connected (Prisma)');
  } catch (err) {
    console.error('Postgres connection error:', err.message);
    process.exit(1);
  }

  // Mongo is kept connected for future use — nothing reads/writes it yet, so
  // a Mongo outage shouldn't block startup the way it used to.
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error (non-fatal):', err.message));

  startAttachmentSweeper();

  server.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
}

start();
