import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

export async function ensureDirectories() {
  const dirs = [
    process.env.MEDIA_DIR || './media',
    process.env.AUTH_DIR || './auth'
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function seedAdminUser() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';

  const exists = await prisma.user.findUnique({ where: { username } });
  if (!exists) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { username, passwordHash } });
    console.log(`✅ Admin user "${username}" created`);
  }
}
