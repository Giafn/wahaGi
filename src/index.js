import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { messageRoutes } from './routes/messages.js';
import { chatRoutes } from './routes/chats.js';
import { contactRoutes } from './routes/contacts.js';
import { ensureDirectories } from './utils/fs.js';
import { swaggerOptions, swaggerUIOptions } from './swagger.js';
import { restoreAllSessions } from './services/sessionManager.js';
import { startMediaCleanup } from './services/mediaCleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }
});

// Swagger setup
await app.register(swagger, swaggerOptions);
await app.register(swaggerUI, swaggerUIOptions);

// Plugins
await app.register(cors, { origin: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'fallback-secret-change-me'
});
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20
  },
  attachFieldsToBody: true
});

// Serve media files (for downloaded media from webhooks)
await app.register(staticFiles, {
  root: path.resolve(process.env.MEDIA_DIR || './media'),
  prefix: '/media/files/',
  decorateReply: false,
  dotfiles: 'allow',
  hidden: true
});

// Serve frontend
await app.register(staticFiles, {
  root: path.join(__dirname, '../frontend'),
  prefix: '/',
  decorateReply: true,
  index: 'index.html'
});

// JWT auth decorator
app.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
});

// Routes
await app.register(authRoutes, { prefix: '/auth' });
await app.register(sessionRoutes, { prefix: '/sessions' });
await app.register(messageRoutes, { prefix: '/sessions' });
await app.register(chatRoutes, { prefix: '/sessions' });
await app.register(contactRoutes, { prefix: '/contacts' });

// Health check
app.get('/health', {
  schema: {
    tags: ['Health'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          version: { type: 'string' }
        }
      }
    }
  }
}, async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0'
}));

// Start server
const start = async () => {
  try {
    await ensureDirectories();
    await prisma.$connect();
    app.log.info('Database connected');

    // Restore all sessions from database
    await restoreAllSessions();
    app.log.info('Sessions restored');

    // Start media cleanup service
    startMediaCleanup();
    app.log.info('Media cleanup service started');

    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';
    await app.listen({ port, host });
    app.log.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  app.log.info('SIGTERM received, shutting down...');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error('[FATAL] Stack:', err.stack);
  // Don't exit - let the app continue running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let the app continue running
});

start();
