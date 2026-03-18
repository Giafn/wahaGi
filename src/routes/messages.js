import { prisma } from '../db/client.js';
import { sendText, sendMediaById } from '../services/messageSender.js';
import { getSession } from '../services/sessionManager.js';

export async function messageRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /sessions/:id/send — send text message
  fastify.post('/:id/send', {
    schema: {
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        required: ['to', 'text'],
        properties: {
          to: { type: 'string', description: 'Phone number with country code' },
          text: { type: 'string' },
          reply_to: { type: 'string', nullable: true, description: 'Message ID to reply to' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message_id: { type: 'string' },
            status: { type: 'string' }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const { to, text, reply_to } = request.body || {};
    if (!to || !text) return reply.code(400).send({ error: 'to and text are required' });

    try {
      const result = await sendText(session.id, to, text, reply_to);
      return { message_id: result.key?.id, status: 'sent' };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /sessions/:id/send-media — send media from pool
  fastify.post('/:id/send-media', {
    schema: {
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        required: ['to', 'media_ids'],
        properties: {
          to: { type: 'string', description: 'Phone number with country code' },
          media_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Array of media IDs from uploaded files'
          },
          caption: { type: 'string', nullable: true },
          reply_to: { type: 'string', nullable: true, description: 'Message ID to reply to' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            sent: { type: 'integer' },
            message_ids: { 
              type: 'array', 
              items: { type: 'string' }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        403: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const { to, media_ids, caption, reply_to } = request.body || {};
    if (!to || !media_ids?.length) return reply.code(400).send({ error: 'to and media_ids are required' });

    // Verify ownership
    const mediaList = await prisma.media.findMany({
      where: { id: { in: media_ids }, userId: request.user.id }
    });
    if (mediaList.length !== media_ids.length) {
      return reply.code(403).send({ error: 'One or more media files not found or not owned by you' });
    }

    // Sort by requested order
    const sorted = media_ids.map(id => mediaList.find(m => m.id === id)).filter(Boolean);

    try {
      const results = await sendMediaById(session.id, to, sorted, caption, reply_to);
      return { sent: results.length, message_ids: results.map(r => r.key?.id) };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // GET /sessions/:id/contacts
  fastify.get('/:id/contacts', {
    schema: {
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              notify: { type: 'string' }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = getSession(session.id);
    if (!live || live.status !== 'connected') return reply.code(400).send({ error: 'Session not connected' });

    const contacts = live.store?.contacts || {};
    return Object.values(contacts).slice(0, 200);
  });
}
