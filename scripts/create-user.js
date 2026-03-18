import { prisma } from '../src/db/client.js';
import bcrypt from 'bcryptjs';

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node scripts/create-user.js <username> <password>');
  process.exit(1);
}

try {
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    console.error('Error: Username already exists');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, passwordHash },
    select: { id: true, username: true, createdAt: true }
  });

  console.log('User created successfully!');
  console.log(user);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
