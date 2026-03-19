import { prisma } from '../db/client.js';

export async function contactRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /contacts - List all contacts with LID mapping
  fastify.get('/', {
    schema: {
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              jid: { type: 'string', description: 'Phone number or LID' },
              lid: { type: 'string', nullable: true, description: 'WhatsApp LID' },
              name: { type: 'string', nullable: true },
              unread_count: { type: 'integer' },
              last_message_time: { type: 'integer', nullable: true }
            }
          }
        }
      }
    }
  }, async (request) => {
    const contacts = await prisma.chat.findMany({
      where: { sessionId: request.user.id },
      orderBy: [{ lastMessageTime: 'desc' }]
    });

    return contacts.map(c => ({
      id: c.id,
      jid: c.jid,
      lid: c.lid,
      name: c.name,
      unread_count: c.unreadCount,
      last_message_time: c.lastMessageTime?.getTime() || null
    }));
  });

  // PUT /contacts/:id/phone - Update LID to phone number mapping
  fastify.put('/:id/phone', {
    schema: {
      tags: ['Contacts'],
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
        required: ['phone'],
        properties: {
          phone: { type: 'string', description: 'Real phone number (e.g., 628123456789)' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { phone } = request.body;

    // Validate phone number format
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return reply.code(400).send({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    try {
      // Update chat jid to phone number
      await prisma.chat.update({
        where: { id },
        data: {
          jid: cleanPhone,
          name: cleanPhone
        }
      });

      // Update all chat history from LID to phone number
      const chat = await prisma.chat.findUnique({ where: { id } });
      if (chat?.lid) {
        await prisma.chatHistory.updateMany({
          where: {
            sessionId: request.user.id,
            from: chat.lid
          },
          data: {
            from: cleanPhone
          }
        });
      }

      return {
        success: true,
        message: `Updated contact from ${chat?.lid || chat?.jid} to ${cleanPhone}`
      };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: err.message
      });
    }
  });

  // GET /contacts/unmapped - List contacts with LID but no phone mapping
  fastify.get('/unmapped', {
    schema: {
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              jid: { type: 'string' },
              lid: { type: 'string' },
              name: { type: 'string' },
              message_count: { type: 'integer' }
            }
          }
        }
      }
    }
  }, async (request) => {
    // Find chats where jid looks like LID (15+ digits)
    const unmapped = await prisma.chat.findMany({
      where: {
        sessionId: request.user.id,
        jid: {
          gte: '100000000000000', // 15 digits minimum
          lt: '1000000000000000' // 16 digits maximum
        }
      },
      include: {
        _count: {
          select: { messages: true }
        }
      },
      orderBy: [{ lastMessageTime: 'desc' }]
    });

    return unmapped.map(c => ({
      id: c.id,
      jid: c.jid,
      lid: c.lid,
      name: c.name,
      message_count: c._count.messages
    }));
  });
}
