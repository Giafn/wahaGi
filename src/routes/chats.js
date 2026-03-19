import { prisma } from '../db/client.js';
import { getSession, getChatList, getChatHistory, getMessagesByLID } from '../services/sessionManager.js';

export async function chatRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /sessions/:id/chats - Get chat list from database
  fastify.get('/:id/chats', {
    schema: {
      tags: ['Chats'],
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
              id: { type: 'string', description: 'Chat database ID' },
              lid: { type: 'string', description: 'WhatsApp LID (primary identifier)' },
              name: { type: 'string', description: 'Contact name or LID' },
              last_chat: { type: 'integer', description: 'Unix timestamp of last message' },
              unread_count: { type: 'integer', description: 'Number of unread messages' }
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

    console.log('[CHATS] Getting chat list for session:', session.id);

    const chats = await getChatList(session.id);

    console.log('[CHATS] Found', chats.length, 'chats');

    return chats;
  });

  // GET /sessions/:id/chats/:lid/messages - Get message history for specific chat by LID
  fastify.get('/:id/chats/:lid/messages', {
    schema: {
      tags: ['Chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'lid'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          lid: { type: 'string', description: 'WhatsApp LID' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              from: { type: 'string' },
              lid: { type: 'string' },
              message: { type: 'string' },
              type: { type: 'string' },
              is_from_me: { type: 'boolean' },
              timestamp: { type: 'integer' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const lid = decodeURIComponent(request.params.lid);
    const { limit = 20 } = request.query;

    console.log('[Chat Messages] Getting messages for LID:', lid, 'limit:', limit);

    const messages = await getChatHistory(session.id, lid, limit);
    console.log('[Chat Messages] Got', messages.length, 'messages');
    return messages;
  });

  // POST /sessions/:id/chats/:lid/read - Mark chat as read
  fastify.post('/:id/chats/:lid/read', {
    schema: {
      tags: ['Chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'lid'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          lid: { type: 'string', description: 'WhatsApp LID' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const { lid } = request.params;

    await prisma.chat.updateMany({
      where: {
        sessionId: session.id,
        lid
      },
      data: {
        unreadCount: 0
      }
    });

    return { success: true };
  });

  // GET /messages/:lid - Get messages by LID (across all sessions)
  fastify.get('/messages/:lid', {
    schema: {
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['lid'],
        properties: {
          lid: { type: 'string', description: 'WhatsApp LID to search' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          session_id: { type: 'string', format: 'uuid', description: 'Filter by session ID (optional)' }
        }
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              session_id: { type: 'string' },
              session_name: { type: 'string' },
              from: { type: 'string' },
              lid: { type: 'string' },
              message: { type: 'string' },
              type: { type: 'string' },
              is_from_me: { type: 'boolean' },
              timestamp: { type: 'integer' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { lid } = request.params;
    const { limit = 50, session_id } = request.query;

    const messages = await getMessagesByLID(lid, session_id, limit);
    return messages;
  });
}
