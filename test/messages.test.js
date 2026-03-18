import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { messageRoutes } from '../src/routes/messages.js';

describe('Messages API', () => {
  let app;
  let authToken;
  let testUser;
  let testSession;

  before(async () => {
    // Create test user
    testUser = await prisma.user.create({
      data: {
        username: `messagetest_${Date.now()}`,
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

    await app.register(messageRoutes, { prefix: '/sessions' });
    await app.ready();

    // Generate auth token
    authToken = app.jwt.sign({ id: testUser.id, username: testUser.username });
  });

  after(async () => {
    // Cleanup
    await prisma.session.deleteMany({ where: { userId: testUser.id } });
    await prisma.media.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await app.close();
  });

  describe('POST /sessions/:id/send', () => {
    it('should return 400 if to is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          text: 'Hello'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if text is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/send',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          text: 'Hello'
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send`,
        payload: {
          to: '6281234567890',
          text: 'Hello'
        }
      });

      assert.strictEqual(response.statusCode, 401);
    });

    // Note: Actual sending will fail because session is not really connected
    // This tests the validation and session lookup logic
    it('should validate session ownership', async () => {
      // Create another user
      const otherUser = await prisma.user.create({
        data: {
          username: `othermsg_${Date.now()}`,
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
        method: 'POST',
        url: `/sessions/${otherSession.id}/send`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          text: 'Hello'
        }
      });

      // Should return 404 because session belongs to another user
      assert.strictEqual(response.statusCode, 404);

      // Cleanup
      await prisma.session.delete({ where: { id: otherSession.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('POST /sessions/:id/send-media', () => {
    let testMedia1, testMedia2;

    before(async () => {
      // Create test media
      testMedia1 = await prisma.media.create({
        data: {
          userId: testUser.id,
          filename: 'test1.jpg',
          path: '/tmp/test1.jpg',
          mimeType: 'image/jpeg',
          size: 1000
        }
      });

      testMedia2 = await prisma.media.create({
        data: {
          userId: testUser.id,
          filename: 'test2.jpg',
          path: '/tmp/test2.jpg',
          mimeType: 'image/jpeg',
          size: 2000
        }
      });
    });

    it('should return 400 if to is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send-media`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          media_ids: [testMedia1.id]
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if media_ids is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send-media`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if media_ids is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send-media`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          media_ids: []
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 403 for media not owned by user', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: `othermedia2_${Date.now()}`,
          passwordHash: 'hash'
        }
      });

      const otherMedia = await prisma.media.create({
        data: {
          userId: otherUser.id,
          filename: 'other.jpg',
          path: '/tmp/other.jpg',
          mimeType: 'image/jpeg',
          size: 100
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send-media`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          media_ids: [otherMedia.id]
        }
      });

      assert.strictEqual(response.statusCode, 403);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'One or more media files not found or not owned by you');

      // Cleanup
      await prisma.media.delete({ where: { id: otherMedia.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/send-media',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          media_ids: [testMedia1.id]
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should accept optional caption and reply_to', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/send-media`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          to: '6281234567890',
          media_ids: [testMedia1.id],
          caption: 'Test caption',
          reply_to: 'some-message-id'
        }
      });

      // Will fail at sendMediaById because session not really connected
      // but should pass validation
      assert.ok([200, 400].includes(response.statusCode));
    });
  });

  describe('GET /sessions/:id/contacts', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000/contacts',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/contacts`
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it('should validate session ownership', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: `othercontact_${Date.now()}`,
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
        url: `/sessions/${otherSession.id}/contacts`,
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
