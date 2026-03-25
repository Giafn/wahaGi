import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db/client.js';

// Mock session manager for testing
const mockSessions = new Map();

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

    mockSessions.set(session.id, { status: 'connecting', qr: null });

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
      status: mockSessions.get(s.id)?.status || s.status,
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

    const live = mockSessions.get(session.id);
    return {
      id: session.id,
      name: session.name,
      status: live?.status || session.status,
      webhook_url: session.webhookUrl,
      created_at: session.createdAt,
      last_seen: session.lastSeen
    };
  });

  // GET /sessions/:id/qr
  fastify.get('/:id/qr', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = mockSessions.get(session.id);
    
    if (!live) {
      mockSessions.set(session.id, { status: 'qr', qr: 'test-qr-code' });
      return { qr: 'test-qr-code', status: 'qr' };
    }

    if (live.qr) {
      return { qr: live.qr, status: live.status };
    }

    return { qr: null, status: live.status || session.status };
  });

  // DELETE /sessions/:id
  fastify.delete('/:id', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    mockSessions.delete(session.id);
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

  // POST /sessions/:id/profile-picture
  fastify.post('/:id/profile-picture', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = mockSessions.get(session.id);
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validMimeTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Invalid file type. Only images are allowed' });
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    const buffer = await data.toBuffer();
    if (buffer.length > maxSize) {
      return reply.code(400).send({ error: 'File size exceeds 5MB limit' });
    }

    return { message: 'Profile picture updated' };
  });

  // POST /sessions/:id/status
  fastify.post('/:id/status', async (request, reply) => {
    const { text } = request.body || {};
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = mockSessions.get(session.id);
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    if (!text || text.trim().length === 0) {
      return reply.code(400).send({ error: 'text is required' });
    }

    if (text.length > 139) {
      return reply.code(400).send({ error: 'Status text must not exceed 139 characters' });
    }

    return { message: 'Status updated' };
  });

  // POST /sessions/:id/restart
  fastify.post('/:id/restart', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = mockSessions.get(session.id);
    if (!live) {
      return reply.code(400).send({ error: 'Session not active' });
    }

    // Simulate restart
    mockSessions.set(session.id, { status: 'connecting', qr: null });
    await new Promise(r => setTimeout(r, 100));

    return { status: 'connecting', qr: null };
  });

  // GET /sessions/:id/status
  fastify.get('/:id/status', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = mockSessions.get(session.id);

    return {
      session_id: session.id,
      status: session.status,
      live_status: live?.status || null,
      last_seen: session.lastSeen,
      webhook_url: session.webhookUrl
    };
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
      assert.strictEqual(body.status, 'connecting');
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

    it('should return empty array when no sessions exist', async () => {
      const newUser = await prisma.user.create({
        data: {
          username: `emptytest_${Date.now()}`,
          passwordHash: 'hash'
        }
      });

      const newToken = app.jwt.sign({ id: newUser.id, username: newUser.username });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions',
        headers: {
          Authorization: `Bearer ${newToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 0);

      // Cleanup
      await prisma.user.delete({ where: { id: newUser.id } });
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

  describe('GET /sessions/:id/qr', () => {
    it('should return QR code for session in QR status', async () => {
      // First create a session and set it to QR status
      const qrSession = await prisma.session.create({
        data: {
          userId: testUser.id,
          name: 'QR Test Session',
          status: 'qr'
        }
      });

      mockSessions.set(qrSession.id, { status: 'qr', qr: 'test-qr-code' });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${qrSession.id}/qr`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.qr, 'test-qr-code');
      assert.strictEqual(body.status, 'qr');

      // Cleanup
      mockSessions.delete(qrSession.id);
      await prisma.session.delete({ where: { id: qrSession.id } });
    });

    it('should return null QR for connected session', async () => {
      const connectedSession = await prisma.session.create({
        data: {
          userId: testUser.id,
          name: 'Connected Session',
          status: 'connected'
        }
      });

      mockSessions.set(connectedSession.id, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${connectedSession.id}/qr`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.qr, null);
      assert.strictEqual(body.status, 'connected');

      // Cleanup
      mockSessions.delete(connectedSession.id);
      await prisma.session.delete({ where: { id: connectedSession.id } });
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000/qr',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/some-id/qr'
      });

      assert.strictEqual(response.statusCode, 401);
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

    it('should return 400 for invalid URL format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/webhook`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          url: 'not-a-valid-url'
        }
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

  describe('POST /sessions/:id/profile-picture', () => {
    it('should return 400 if session is not connected', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/profile-picture`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Session not connected');
    });

    it('should return 400 if no file is uploaded', async () => {
      // Set session to connected
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/profile-picture`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'No file uploaded');
    });

    it('should return 400 for invalid file type', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/profile-picture`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'multipart/form-data'
        },
        payload: Buffer.from('fake pdf content')
      });

      // Will fail validation
      assert.ok([400, 415].includes(response.statusCode));
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/profile-picture',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/some-id/profile-picture',
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('POST /sessions/:id/status', () => {
    it('should update status successfully', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: 'Available'
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.message, 'Status updated');
    });

    it('should return 400 if text is missing', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {}
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if text is empty string', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: ''
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if text exceeds 139 characters', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const longText = 'a'.repeat(140);

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: longText
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if session is not connected', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: 'Test status'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/status',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: 'Test'
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe('POST /sessions/:id/restart', () => {
    it('should restart session successfully', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/restart`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, 'connecting');
    });

    it('should return 400 if session is not active', async () => {
      mockSessions.delete(testSessionId);

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSessionId}/restart`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/restart',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/some-id/restart'
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('GET /sessions/:id/status', () => {
    it('should return session status details', async () => {
      mockSessions.set(testSessionId, { status: 'connected', qr: null });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.session_id, testSessionId);
      assert.strictEqual(body.live_status, 'connected');
      assert.ok('webhook_url' in body);
      assert.ok('last_seen' in body);
    });

    it('should return null live_status for inactive session', async () => {
      mockSessions.delete(testSessionId);

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSessionId}/status`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.live_status, null);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000/status',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/some-id/status'
      });

      assert.strictEqual(response.statusCode, 401);
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

      mockSessions.set(sessionToDelete.id, { status: 'connecting', qr: null });

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
      assert.strictEqual(mockSessions.has(sessionToDelete.id), false);
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

    it('should return 404 for another user session', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: `deleteothertest_${Date.now()}`,
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
        method: 'DELETE',
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
});
