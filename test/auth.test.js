import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { authRoutes } from '../src/routes/auth.js';
import bcrypt from 'bcryptjs';

describe('Auth API', () => {
  let app;
  let testUserId;
  let authToken;

  before(async () => {
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

    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();

    // Clean up and create test user manually (since /register is disabled)
    await prisma.user.deleteMany({ where: { username: { in: ['testuser', 'testuser2'] } } });
    
    // Create test user manually
    const testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        passwordHash: await bcrypt.hash('password123', 12)
      }
    });
    testUserId = testUser.id;
  });

  after(async () => {
    // Cleanup
    await prisma.user.deleteMany({ where: { username: { in: ['testuser', 'testuser2'] } } });
    await app.close();
  });

  describe('POST /auth/register', () => {
    // NOTE: /auth/register is disabled in production for security
    // These tests are skipped as the endpoint is intentionally disabled
    // To enable self-registration, uncomment the route in src/routes/auth.js
    it.skip('should register a new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: 'testuser',
          password: 'password123'
        }
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.token);
      assert.ok(body.user);
      assert.strictEqual(body.user.username, 'testuser');
      assert.ok(body.user.id);
      testUserId = body.user.id;
    });

    it.skip('should return 400 if username is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          password: 'password123'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it.skip('should return 400 if password is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: 'testuser2'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it.skip('should return 409 if username already exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: 'testuser',
          password: 'anotherpassword'
        }
      });

      assert.strictEqual(response.statusCode, 409);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Username already taken');
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'testuser',
          password: 'password123'
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.token);
      assert.ok(body.user);
      assert.strictEqual(body.user.username, 'testuser');
      authToken = body.token; // Store for /me tests
    });

    it('should return 401 for invalid username', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'nonexistentuser',
          password: 'password123'
        }
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Invalid credentials');
    });

    it('should return 401 for invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'testuser',
          password: 'wrongpassword'
        }
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Invalid credentials');
    });

    it('should return 400 if username is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          password: 'password123'
        }
      });

      // Fastify validation returns 400 for missing required fields
      assert.strictEqual(response.statusCode, 400);
    });

    it('should return 400 if password is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'testuser'
        }
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe('GET /auth/me', () => {
    it('should return current user info with valid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.username, 'testuser');
      assert.ok(body.id);
      assert.ok(body.createdAt);
    });

    it('should return 401 without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me'
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it('should return 401 with invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          Authorization: 'Bearer invalid-token'
        }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
