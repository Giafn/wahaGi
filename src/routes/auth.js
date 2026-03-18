import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

export async function authRoutes(fastify) {
  // POST /auth/login
  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' }
              }
            }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      { id: user.id, username: user.username },
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    return { token, user: { id: user.id, username: user.username } };
  });

  // POST /auth/register - DISABLED for security
  // Uncomment below to enable self-registration
  /*
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' }
              }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;

    if (!username || !password) {
      return reply.code(400).send({ error: 'username and password required' });
    }

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) {
      return reply.code(409).send({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: { id: true, username: true, createdAt: true }
    });

    const token = fastify.jwt.sign(
      { id: user.id, username: user.username },
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    return reply.code(201).send({ token, user });
  });
  */

  // GET /auth/me
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, username: true, createdAt: true }
    });
    return user;
  });
}
