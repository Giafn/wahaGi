import { test } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import supertest from 'supertest';

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
