import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { chatRoutes } from '../src/routes/chats.js';

describe('Chats API', () => {
  let app;
  let authToken;
  let testUser;
  let testSession;

  before(async () => {
    // Create test user
    testUser = await prisma.user.create({
      data: {
        username: `chatstest_${Date.now()}`,
        passwordHash: 'hash'
      }
    });

    // Create test session
    testSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        name: 'Test Session',
        status: 'connected'
      }
    });

    // Create test app
    app = fastify({ logger: false });
    
    await app.register(import('@fastify/cors'), { origin: true });
    await app.register(import('@fastify/jwt'), {
      secret: 'test-jwt-secret-for-unit-tests'
    });
    await app.register(import('@fastify/multipart'), {
      limits: { fileSize: 50 * 1024 * 1024, files: 20 }
    });

    app.decorate('authenticate', async function (request, reply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
      }
    });

    await app.register(chatRoutes, { prefix: '/sessions' });
    await app.ready();

    // Generate auth token
    authToken = app.jwt.sign({ id: testUser.id, username: testUser.username });
  });

  after(async () => {
    // Cleanup
    await prisma.session.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await app.close();
  });

  describe('GET /sessions/:id/chats', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000/chats',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Session not found');
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats`
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it('should validate session ownership', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: `otherchats_${Date.now()}`,
          passwordHash: 'hash'
        }
      });

      const otherSession = await prisma.session.create({
        data: {
          userId: otherUser.id,
          name: 'Other Session',
          status: 'connected'
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${otherSession.id}/chats`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);

      // Cleanup
      await prisma.session.delete({ where: { id: otherSession.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });
});
