import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await prisma.user.findUnique({ where: { id: Number(decoded.id) } });

    if (!req.user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    delete req.user.password;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export default protect;
