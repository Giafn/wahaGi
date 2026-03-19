import { prisma } from '../db/client.js';

export async function contactRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /contacts - List all contacts with LID
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
              lid: { type: 'string', description: 'WhatsApp LID (primary identifier)' },
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
      lid: c.lid,
      name: c.name,
      unread_count: c.unreadCount,
      last_message_time: c.lastMessageTime?.getTime() || null
    }));
  });

  // GET /contacts/:id - Get single contact by database ID
  fastify.get('/:id', {
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
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            lid: { type: 'string' },
            name: { type: 'string', nullable: true },
            unread_count: { type: 'integer' },
            last_message_time: { type: 'integer', nullable: true }
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
  fastify.put('/:id/name', {
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
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Contact name' }
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
  fastify.delete('/:id', {
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
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
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
