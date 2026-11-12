import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config, isDemoMode } from '../config';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import { ForbiddenError, InternalServerError } from '../utils/errors';

export const demoLogin = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  if (!isDemoMode) {
    throw new ForbiddenError('Demo login is disabled');
  }
  if (!config.JWT_SECRET) {
    throw new InternalServerError('JWT_SECRET must be configured for demo login');
  }

  const user = await prisma.user.upsert({
    where: { email: config.DEMO_USER_EMAIL },
    update: { name: 'Alex Morgan' },
    create: {
      email: config.DEMO_USER_EMAIL,
      name: 'Alex Morgan',
    },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });

  const options: SignOptions = {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  const token = jwt.sign(
    { email: user.email, name: user.name ?? undefined },
    config.JWT_SECRET,
    options
  );

  res.json({ success: true, data: { token, user } });
});
