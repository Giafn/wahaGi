import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db/client.js';

// Test contacts routes
async function testContactsRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /contacts - List all contacts
  fastify.get('/', async (request) => {
    const contacts = await prisma.chat.findMany({
      where: { sessionId: request.user.id },
      orderBy: [{ lastMessageTime: 'desc' }]
    });

    return contacts.map(c => ({
      id: c.id,
      lid: c.lid,
      name: c.name,
      unread_count: c.unreadCount,
      last_message_time: c.lastMessageTime?.getTime() || null
    }));
  });

  // GET /contacts/:id - Get single contact by database ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const contact = await prisma.chat.findUnique({
      where: { id }
    });

    if (!contact) {
      return reply.code(404).send({ error: 'Contact not found' });
    }

    return {
      id: contact.id,
      lid: contact.lid,
      name: contact.name,
      unread_count: contact.unreadCount,
      last_message_time: contact.lastMessageTime?.getTime() || null
    };
  });

  // PUT /contacts/:id/name - Update name for a contact
  fastify.put('/:id/name', async (request, reply) => {
    const { id } = request.params;
    const { name } = request.body;

    if (!name || name.trim().length === 0) {
      return reply.code(400).send({
        success: false,
        message: 'Name is required'
      });
    }

    try {
      await prisma.chat.update({
        where: { id },
        data: {
          name: name.trim()
        }
      });

      return {
        success: true,
        message: `Updated name for contact ${id}`
      };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: err.message
      });
    }
  });

  // DELETE /contacts/:id - Delete a contact
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;

    const contact = await prisma.chat.findUnique({
      where: { id }
    });

    if (!contact) {
      return reply.code(404).send({ error: 'Contact not found' });
    }

    await prisma.chat.delete({
      where: { id }
    });

    return {
      success: true,
      message: `Deleted contact ${id}`
    };
  });
}

describe('Contacts API', () => {
  let app;
  let authToken;
  let testUser;
  let testSession;
  let testContact;

  before(async () => {
    // Create test user
    testUser = await prisma.user.create({
      data: {
        username: `contactstest_${Date.now()}`,
        passwordHash: await bcrypt.hash('password123', 12)
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

    // Create test contact
    testContact = await prisma.chat.create({
      data: {
        sessionId: testSession.id,
        lid: '628123456789',
        name: 'Test Contact',
        unreadCount: 5,
        lastMessageTime: new Date()
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

    await app.register(testContactsRoutes, { prefix: '/contacts' });
    await app.ready();

    // Generate auth token
    authToken = app.jwt.sign({ id: testUser.id, username: testUser.username });
  });

  after(async () => {
    // Cleanup
    await prisma.chat.deleteMany({ where: { sessionId: testSession.id } });
    await prisma.session.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await app.close();
  });

  describe('GET /contacts', () => {
    it('should list all contacts for the user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/contacts',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);

      const contact = body.find(c => c.id === testContact.id);
      assert.ok(contact);
      assert.strictEqual(contact.lid, testContact.lid);
      assert.strictEqual(contact.name, testContact.name);
      assert.strictEqual(contact.unread_count, testContact.unreadCount);
    });

    it('should return empty array when no contacts exist', async () => {
      const newUser = await prisma.user.create({
        data: {
          username: `emptycontactstest_${Date.now()}`,
          passwordHash: 'hash'
        }
      });

      const newSession = await prisma.session.create({
        data: {
          userId: newUser.id,
          name: 'Empty Session',
          status: 'connected'
        }
      });

      const newToken = app.jwt.sign({ id: newUser.id, username: newUser.username });

      const response = await app.inject({
        method: 'GET',
        url: '/contacts',
        headers: {
          Authorization: `Bearer ${newToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body));
      assert.strictEqual(body.length, 0);

      // Cleanup
      await prisma.session.delete({ where: { id: newSession.id } });
      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/contacts'
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it('should order contacts by last message time descending', async () => {
      // Create another contact with earlier timestamp
      const oldContact = await prisma.chat.create({
        data: {
          sessionId: testSession.id,
          lid: '628987654321',
          name: 'Old Contact',
          unreadCount: 0,
          lastMessageTime: new Date(Date.now() - 86400000) // 1 day ago
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/contacts',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      
      // testContact should come before oldContact (newer first)
      const testContactIndex = body.findIndex(c => c.id === testContact.id);
      const oldContactIndex = body.findIndex(c => c.id === oldContact.id);
      
      assert.ok(testContactIndex < oldContactIndex);

      // Cleanup
      await prisma.chat.delete({ where: { id: oldContact.id } });
    });
  });

  describe('GET /contacts/:id', () => {
    it('should get single contact by id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/contacts/${testContact.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.id, testContact.id);
      assert.strictEqual(body.lid, testContact.lid);
      assert.strictEqual(body.name, testContact.name);
      assert.strictEqual(body.unread_count, testContact.unreadCount);
    });

    it('should return 404 for non-existent contact', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/contacts/00000000-0000-0000-0000-000000000000',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Contact not found');
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/contacts/${testContact.id}`
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('PUT /contacts/:id/name', () => {
    it('should update contact name successfully', async () => {
      const newName = 'Updated Contact Name';

      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: newName
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.message.includes(testContact.id));

      // Verify the update
      const updatedContact = await prisma.chat.findUnique({
        where: { id: testContact.id }
      });
      assert.strictEqual(updatedContact.name, newName);
    });

    it('should trim whitespace from name', async () => {
      const newName = '  Trimmed Name  ';

      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: newName
        }
      });

      assert.strictEqual(response.statusCode, 200);

      // Verify the update is trimmed
      const updatedContact = await prisma.chat.findUnique({
        where: { id: testContact.id }
      });
      assert.strictEqual(updatedContact.name, 'Trimmed Name');
    });

    it('should return 400 if name is missing', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {}
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Name is required');
    });

    it('should return 400 if name is empty string', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: ''
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if name is whitespace only', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: '   '
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 404 for non-existent contact', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/contacts/00000000-0000-0000-0000-000000000000/name',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          name: 'Test Name'
        }
      });

      assert.strictEqual(response.statusCode, 500);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/contacts/${testContact.id}/name`,
        payload: {
          name: 'Test'
        }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('DELETE /contacts/:id', () => {
    let contactToDelete;

    before(async () => {
      contactToDelete = await prisma.chat.create({
        data: {
          sessionId: testSession.id,
          lid: '628111222333',
          name: 'Contact to Delete',
          unreadCount: 0,
          lastMessageTime: new Date()
        }
      });
    });

    it('should delete contact successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/contacts/${contactToDelete.id}`,
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.message.includes(contactToDelete.id));

      // Verify deletion
      const deletedContact = await prisma.chat.findUnique({
        where: { id: contactToDelete.id }
      });
      assert.strictEqual(deletedContact, null);
    });

    it('should return 404 for non-existent contact', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/contacts/00000000-0000-0000-0000-000000000000',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Contact not found');
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/contacts/${testContact.id}`
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
