import { test } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import bcrypt from 'bcryptjs';

// Test setup helper
export async function createTestApp() {
  const app = fastify({ logger: false });

  // Register plugins
  await app.register(import('@fastify/cors'), { origin: true });
  await app.register(import('@fastify/jwt'), {
    secret: 'test-jwt-secret-for-unit-tests'
  });
  await app.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 20
    }
  });

  // JWT auth decorator for testing
  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  });

  return app;
}

// Generate test JWT token
export function generateToken(userId, username) {
  const app = fastify({ logger: false });
  app.register(import('@fastify/jwt'), {
    secret: 'test-jwt-secret-for-unit-tests'
  });

  return app.jwt.sign({ id: userId, username });
}

// Test response schema helper
export function assertResponseSchema(response, expectedFields) {
  for (const field of expectedFields) {
    assert.ok(field in response, `Response should have field: ${field}`);
  }
}

// Create test user helper
export async function createTestUser(usernamePrefix = 'testuser') {
  const username = `${usernamePrefix}_${Date.now()}`;
  const password = 'password123';
  
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });

  return { user, password };
}

// Create test session helper
export async function createTestSession(userId, sessionName = 'Test Session', status = 'connected') {
  return await prisma.session.create({
    data: {
      userId,
      name: sessionName,
      status
    }
  });
}

// Create test chat helper
export async function createTestChat(sessionId, lid, name = null, unreadCount = 0) {
  return await prisma.chat.create({
    data: {
      sessionId,
      lid,
      name,
      unreadCount,
      lastMessageTime: new Date()
    }
  });
}

// Create test message helper
export async function createTestMessage(sessionId, from, message, type = 'text', isFromMe = false) {
  return await prisma.chatHistory.create({
    data: {
      sessionId,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      from,
      message,
      type,
      isFromMe,
      timestamp: new Date()
    }
  });
}

// Create test media helper
export async function createTestMedia(userId, filename = 'test.jpg', mimeType = 'image/jpeg', size = 1000) {
  return await prisma.media.create({
    data: {
      userId,
      filename,
      path: `/tmp/${filename}`,
      mimeType,
      size
    }
  });
}

// Cleanup helper for test data
export async function cleanupTestData(options = {}) {
  const { userId, sessionIds, chatIds } = options;

  if (chatIds && chatIds.length > 0) {
    await prisma.chat.deleteMany({ where: { id: { in: chatIds } } });
  }

  if (sessionIds && sessionIds.length > 0) {
    await prisma.chatHistory.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.chat.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.media.deleteMany({ where: { userId: { in: sessionIds.map(() => userId) } } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  }

  if (userId) {
    await prisma.media.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
}

// Simple cleanup for single user test data
export async function cleanupUserTest(user, sessions = []) {
  if (!user) return;

  const sessionIds = sessions.filter(Boolean).map(s => s.id);

  if (sessionIds.length > 0) {
    await prisma.chatHistory.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.chat.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.media.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  }

  await prisma.user.delete({ where: { id: user.id } });
}

// Multi-user setup for ownership testing
export async function setupMultiUserTest() {
  const user1 = await createTestUser('owner');
  const user2 = await createTestUser('other');
  
  const session1 = await createTestSession(user1.user.id, 'Owner Session');
  const session2 = await createTestSession(user2.user.id, 'Other Session');

  return {
    user1: user1.user,
    user2: user2.user,
    session1,
    session2,
    password1: user1.password,
    password2: user2.password
  };
}

// Database seed helper for pre-populating test data
export async function seedDatabase(data) {
  const created = {};

  if (data.users) {
    created.users = await Promise.all(
      data.users.map(async (u) => {
        return await prisma.user.create({
          data: {
            username: u.username,
            passwordHash: u.passwordHash || await bcrypt.hash('password', 12)
          }
        });
      })
    );
  }

  if (data.sessions) {
    created.sessions = await Promise.all(
      data.sessions.map(async (s) => {
        return await prisma.session.create({
          data: {
            userId: s.userId,
            name: s.name,
            status: s.status || 'connected'
          }
        });
      })
    );
  }

  if (data.chats) {
    created.chats = await Promise.all(
      data.chats.map(async (c) => {
        return await prisma.chat.create({
          data: {
            sessionId: c.sessionId,
            lid: c.lid,
            name: c.name,
            unreadCount: c.unreadCount || 0,
            lastMessageTime: c.lastMessageTime || new Date()
          }
        });
      })
    );
  }

  if (data.messages) {
    created.messages = await Promise.all(
      data.messages.map(async (m) => {
        return await prisma.chatHistory.create({
          data: {
            sessionId: m.sessionId,
            messageId: m.messageId || `msg_${Date.now()}`,
            from: m.from,
            message: m.message,
            type: m.type || 'text',
            isFromMe: m.isFromMe || false,
            timestamp: m.timestamp || new Date()
          }
        });
      })
    );
  }

  return created;
}

// Assert helper for common response patterns
export const assertResponse = {
  success: (body, additionalFields = []) => {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    assert.strictEqual(data.success, true);
    additionalFields.forEach(field => {
      assert.ok(field in data, `Response should have field: ${field}`);
    });
  },
  
  error: (body, errorCode = 'error') => {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    assert.ok(errorCode in data || 'error' in data || 'message' in data);
  },
  
  unauthorized: (response) => {
    assert.strictEqual(response.statusCode, 401);
    const body = JSON.parse(response.body);
    assert.ok(body.error || body.message);
  },
  
  notFound: (response) => {
    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assert.ok(body.error || body.message);
  },
  
  badRequest: (response) => {
    assert.strictEqual(response.statusCode, 400);
  }
};

// Mock session manager for testing without real WhatsApp connection
export const mockSessionManager = {
  sessions: new Map(),
  
  set(sessionId, data) {
    this.sessions.set(sessionId, data);
  },
  
  get(sessionId) {
    return this.sessions.get(sessionId);
  },
  
  delete(sessionId) {
    this.sessions.delete(sessionId);
  },
  
  clear() {
    this.sessions.clear();
  }
};
