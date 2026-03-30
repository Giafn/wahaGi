import { prisma } from '../db/client.js';
import { sendText } from '../services/messageSender.js';
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
          to: { type: 'string', description: 'WhatsApp LID (Legacy ID)' },
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

  // POST /sessions/:id/presence — manually set presence
  fastify.post('/:id/presence', {
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
        required: ['presence'],
        properties: {
          presence: {
            type: 'string',
            enum: ['available', 'unavailable', 'composing', 'recording', 'paused']
          },
          to: { type: 'string', nullable: true, description: 'Specific JID to send presence to' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' }
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

    const { presence, to } = request.body || {};

    try {
      const jid = to ? toJID(to) : null;
      await live.socket.sendPresenceUpdate(presence, jid);
      return { message: `Presence set to ${presence}` };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}

function toJID(lid) {
  if (!lid) return '';
  if (lid.includes('@')) return lid;
  if (lid.includes('-') || (lid.length >= 15 && /^\d+$/.test(lid))) {
    return `${lid}@g.us`;
  }
  return `${lid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}
