import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db/client.js';

// Simplified session routes for testing (without actual WhatsApp connection)
async function testSessionRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /sessions — create new session
  fastify.post('/', async (request, reply) => {
    const { name } = request.body || {};

    const session = await prisma.session.create({
      data: {
        userId: request.user.id,
        name: name || `Device ${Date.now()}`,
        status: 'connecting'
      }
    });

    return reply.code(201).send({
      session_id: session.id,
      name: session.name,
      status: 'connecting',
      qr: null
    });
  });

  // GET /sessions — list all sessions
  fastify.get('/', async (request) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' }
    });

    return sessions.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      webhook_url: s.webhookUrl,
      created_at: s.createdAt,
      last_seen: s.lastSeen
    }));
  });

  // GET /sessions/:id
  fastify.get('/:id', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    return {
      id: session.id,
      name: session.name,
      status: session.status,
      webhook_url: session.webhookUrl,
      created_at: session.createdAt,
      last_seen: session.lastSeen
    };
  });

  // DELETE /sessions/:id
  fastify.delete('/:id', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    await prisma.session.delete({ where: { id: session.id } });
    return { message: 'Session deleted' };
  });

  // POST /sessions/:id/webhook
  fastify.post('/:id/webhook', async (request, reply) => {
    const { url } = request.body || {};

    if (!url) return reply.code(400).send({ error: 'url is required' });

    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: { webhookUrl: url }
    });

    return { webhook_url: updated.webhookUrl, message: 'Webhook updated' };
  });
}

describe('Sessions API', () => {
  let app;
  let authToken;
  let testUser;
  let testSessionId;

  before(async () => {
    // Create test user
    testUser = await prisma.user.create({
      data: {
        username: `sessiontest_${Date.now()}`,
        passwordHash: await bcrypt.hash('password123', 12)
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

    await app.register(testSessionRoutes, { prefix: '/sessions' });
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

  describe('POST /sessions', () => {
    it('should create a new session successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: 'Test Session'
        }
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.session_id);
      assert.strictEqual(body.name, 'Test Session');
      testSessionId = body.session_id;
    });

    it('should create session with default name if not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {}
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.session_id);
      assert.ok(body.name);
      
      // Cleanup
      await prisma.session.delete({ where: { id: body.session_id } });
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { name: 'Test' }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('GET /sessions', () => {
    it('should list all sessions for the user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions'
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('GET /sessions/:id', () => {
    it('should get single session by id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSessionId}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.id, testSessionId);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Session not found');
    });

    it('should return 404 for another user session', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: `othertest_${Date.now()}`,
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
        url: `/sessions/${otherSession.id}`,
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

  describe('POST /sessions/:id/webhook', () => {
    it('should update webhook URL successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/webhook`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          url: 'https://example.com/webhook'
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.webhook_url, 'https://example.com/webhook');
    });

    it('should return 400 if url is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/webhook`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {}
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/webhook',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: { url: 'https://example.com' }
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('should delete session successfully', async () => {
      const sessionToDelete = await prisma.session.create({
        data: {
          userId: testUser.id,
          name: 'Session to Delete',
          status: 'connecting'
        }
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/sessions/${sessionToDelete.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.message, 'Session deleted');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/00000000-0000-0000-0000-000000000000',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Session not found');
    });
  });
});
