import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create admin user
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const exists = await prisma.user.findUnique({ where: { username } });

  if (exists) {
    console.log(`⚠️  User "${username}" already exists, skipping.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: { id: true, username: true }
    });
    console.log(`✅ Admin user created: ${user.username} (${user.id})`);
  }

  console.log('\n✅ Seeding completed!');
}

main()
  .catch(e => {
    console.error('❌ Seeding failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
