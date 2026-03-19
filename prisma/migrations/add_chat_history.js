// Migration to add chat history tables
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Adding chat history tables...');
  
  // Note: Run this via prisma migrate dev or prisma db push
  // This is just a reference for the schema changes
  
  console.log('Chat history schema:');
  console.log(`
    model ChatHistory {
      id        String   @id @default(uuid())
      sessionId String
      from      String
      message   String
      type      String   @default("text")
      timestamp DateTime
      createdAt DateTime @default(now())
      
      @@index([sessionId, from])
      @@index([sessionId, timestamp])
    }
  `);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
