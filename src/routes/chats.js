import { prisma } from '../db/client.js';
import { getSession, getChatList, getChatHistory, getMessagesByPhoneNumber } from '../services/sessionManager.js';

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
              id: { type: 'string', description: 'Chat JID (e.g., 628xxx@s.whatsapp.net)' },
              name: { type: 'string', description: 'Contact name or phone number' },
              last_message: {
                type: 'object',
                nullable: true,
                properties: {
                  text: { type: 'string', description: 'Message text or [type] for media' },
                  type: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'document'] },
                  is_from_me: { type: 'boolean', description: 'True if outgoing message' },
                  timestamp: { type: 'integer', description: 'Unix timestamp' }
                }
              },
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

    // Get chat list from database (works even if session not connected)
    const chats = await getChatList(session.id);

    console.log('[CHATS] Found', chats.length, 'chats');

    return chats;
  });

  // GET /sessions/:id/chats/:jid/messages - Get message history for specific chat
  fastify.get('/:id/chats/:jid/messages', {
    schema: {
      tags: ['Chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'jid'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          jid: { type: 'string' }
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

    // Decode JID from URL (handle @ encoded as %40)
    const jid = decodeURIComponent(request.params.jid);
    const { limit = 20 } = request.query;

    console.log('[Chat Messages] Getting messages for JID:', jid, 'limit:', limit);

    const messages = await getChatHistory(session.id, jid, limit);
    console.log('[Chat Messages] Got', messages.length, 'messages');
    return messages;
  });

  // POST /sessions/:id/chats/:jid/read - Mark chat as read
  fastify.post('/:id/chats/:jid/read', {
    schema: {
      tags: ['Chats'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'jid'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          jid: { type: 'string' }
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

    const { jid } = request.params;

    await prisma.chat.updateMany({
      where: {
        sessionId: session.id,
        jid
      },
      data: {
        unreadCount: 0
      }
    });

    return { success: true };
  });

  // GET /messages/:phoneNumber - Get messages by phone number (across all sessions)
  fastify.get('/messages/:phoneNumber', {
    schema: {
      tags: ['Messages'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['phoneNumber'],
        properties: {
          phoneNumber: { type: 'string', description: 'Phone number to search (e.g., 628123456789)' }
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
    const { phoneNumber } = request.params;
    const { limit = 50, session_id } = request.query;

    const messages = await getMessagesByPhoneNumber(phoneNumber, session_id, limit);
    return messages;
  });
}
