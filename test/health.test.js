import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';

describe('Health API', () => {
  let app;

  before(async () => {
    app = fastify({ logger: false });
    
    // Health check endpoint
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

    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.timestamp);
      assert.strictEqual(body.version, '1.0.0');
    });

    it('should return valid timestamp format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      const body = JSON.parse(response.body);
      const timestamp = new Date(body.timestamp);
      assert.ok(!isNaN(timestamp.getTime()), 'Timestamp should be valid date');
    });

    it('should not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      assert.strictEqual(response.statusCode, 200);
    });
  });
});
