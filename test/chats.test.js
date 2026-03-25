import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { chatRoutes } from '../src/routes/chats.js';
import { cleanupUserTest } from './helpers.js';

describe('Chats API', () => {
  let app;
  let authToken;
  let testUser;
  let testSession;
  let testChat;
  let testMessage1;
  let testMessage2;

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

    // Create test chat
    testChat = await prisma.chat.create({
      data: {
        sessionId: testSession.id,
        lid: '628123456789',
        name: 'Test Chat',
        unreadCount: 5,
        lastMessageTime: new Date()
      }
    });

    // Create test messages
    testMessage1 = await prisma.chatHistory.create({
      data: {
        sessionId: testSession.id,
        messageId: 'msg_001',
        from: testChat.lid,
        message: 'Hello World',
        type: 'text',
        isFromMe: false,
        timestamp: new Date(Date.now() - 3600000) // 1 hour ago
      }
    });

    testMessage2 = await prisma.chatHistory.create({
      data: {
        sessionId: testSession.id,
        messageId: 'msg_002',
        from: testChat.lid,
        message: 'Second message',
        type: 'text',
        isFromMe: false,
        timestamp: new Date()
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
    // Cleanup using helper
    await cleanupUserTest(testUser, [testSession]);
    await app.close();
  });

  describe('GET /sessions/:id/chats', () => {
    it('should return list of chats for the session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);

      const chat = body.find(c => c.id === testChat.id);
      assert.ok(chat);
      assert.strictEqual(chat.lid, testChat.lid);
      assert.strictEqual(chat.name, testChat.name);
    });

    it('should return empty array when no chats exist', async () => {
      const newSession = await prisma.session.create({
        data: {
          userId: testUser.id,
          name: 'Empty Chats Session',
          status: 'connected'
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${newSession.id}/chats`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 0);

      // Cleanup
      await prisma.session.delete({ where: { id: newSession.id } });
    });

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

    it('should order chats by last message time descending', async () => {
      const oldChat = await prisma.chat.create({
        data: {
          sessionId: testSession.id,
          lid: '628987654321',
          name: 'Old Chat',
          unreadCount: 0,
          lastMessageTime: new Date(Date.now() - 86400000) // 1 day ago
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      
      const testChatIndex = body.findIndex(c => c.id === testChat.id);
      const oldChatIndex = body.findIndex(c => c.id === oldChat.id);
      
      assert.ok(testChatIndex < oldChatIndex);

      // Cleanup
      await prisma.chat.delete({ where: { id: oldChat.id } });
    });
  });

  describe('GET /sessions/:id/chats/:lid/messages', () => {
    it('should return message history for a specific LID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${testChat.lid}/messages`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
      
      // Should contain our test messages
      const msgIds = body.map(m => m.message_id);
      assert.ok(msgIds.includes('msg_001'));
      assert.ok(msgIds.includes('msg_002'));
    });

    it('should return empty array when no messages exist for LID', async () => {
      const newChat = await prisma.chat.create({
        data: {
          sessionId: testSession.id,
          lid: '628000000000',
          name: 'No Messages Chat',
          unreadCount: 0,
          lastMessageTime: new Date()
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${newChat.lid}/messages`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 0);

      // Cleanup
      await prisma.chat.delete({ where: { id: newChat.id } });
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${testChat.lid}/messages?limit=1`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 1);
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${testChat.lid}/messages?limit=invalid`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/00000000-0000-0000-0000-000000000000/chats/somelid/messages',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${testChat.lid}/messages`
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it('should return messages ordered by timestamp descending', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${testSession.id}/chats/${testChat.lid}/messages`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      
      // msg_002 (newer) should come before msg_001 (older)
      const msg002Index = body.findIndex(m => m.message_id === 'msg_002');
      const msg001Index = body.findIndex(m => m.message_id === 'msg_001');
      
      assert.ok(msg002Index < msg001Index);
    });
  });

  describe('POST /sessions/:id/chats/:lid/read', () => {
    let chatWithUnread;

    before(async () => {
      chatWithUnread = await prisma.chat.create({
        data: {
          sessionId: testSession.id,
          lid: '628777888999',
          name: 'Unread Chat',
          unreadCount: 10,
          lastMessageTime: new Date()
        }
      });
    });

    after(async () => {
      await prisma.chat.delete({ where: { id: chatWithUnread.id } });
    });

    it('should mark chat as read (reset unread count to 0)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/chats/${chatWithUnread.lid}/read`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.message.includes('marked as read'));

      // Verify unread count is reset
      const updatedChat = await prisma.chat.findUnique({
        where: { id: chatWithUnread.id }
      });
      assert.strictEqual(updatedChat.unreadCount, 0);
    });

    it('should handle already read chat (unread count = 0)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/chats/${chatWithUnread.lid}/read`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/00000000-0000-0000-0000-000000000000/chats/somelid/read',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${testSession.id}/chats/${chatWithUnread.lid}/read`
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('GET /sessions/messages/:lid', () => {
    it('should return messages by LID across all sessions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/messages/${testChat.lid}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);

      // Should include session info
      const msg = body[0];
      assert.ok('session_id' in msg);
      assert.ok('from' in msg);
      assert.ok('message' in msg);
    });

    it('should filter messages by session_id when provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/messages/${testChat.lid}?session_id=${testSession.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));

      // All messages should be from the filtered session
      body.forEach(msg => {
        assert.strictEqual(msg.session_id, testSession.id);
      });
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/messages/${testChat.lid}?limit=1`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 1);
    });

    it('should return empty array for LID with no messages', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/messages/999999999999',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 0);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/messages/${testChat.lid}`
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
