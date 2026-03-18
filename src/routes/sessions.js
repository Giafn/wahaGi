import { prisma } from '../db/client.js';
import { createSession, deleteSession, getSession } from '../services/sessionManager.js';
import QRCode from 'qrcode';

export async function sessionRoutes(fastify) {
  // All routes require auth
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /sessions — create new session
  fastify.post('/', {
    schema: {
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['connecting', 'qr', 'connected'] },
            qr: { type: 'string', description: 'Base64 encoded QR code' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { name } = request.body || {};

    const session = await prisma.session.create({
      data: {
        userId: request.user.id,
        name: name || `Device ${Date.now()}`,
        status: 'connecting'
      }
    });

    const result = await createSession(session.id, request.user.id);

    let qrBase64 = null;
    if (result.qr) {
      qrBase64 = await QRCode.toDataURL(result.qr);
    }

    return reply.code(201).send({
      session_id: session.id,
      name: session.name,
      status: result.status,
      qr: qrBase64
    });
  });

  // GET /sessions — list all sessions
  fastify.get('/', {
    schema: {
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string' },
              webhook_url: { type: 'string', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
              last_seen: { type: 'string', format: 'date-time', nullable: true }
            }
          }
        }
      }
    }
  }, async (request) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' }
    });

    return sessions.map(s => {
      const live = getSession(s.id);
      return {
        id: s.id,
        name: s.name,
        status: live?.status || s.status,
        webhook_url: s.webhookUrl,
        created_at: s.createdAt,
        last_seen: s.lastSeen
      };
    });
  });

  // GET /sessions/:id — get single session
  fastify.get('/:id', {
    schema: {
      tags: ['Sessions'],
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
            name: { type: 'string' },
            status: { type: 'string' },
            webhook_url: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            last_seen: { type: 'string', format: 'date-time', nullable: true }
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
    return {
      id: session.id,
      name: session.name,
      status: live?.status || session.status,
      webhook_url: session.webhookUrl,
      created_at: session.createdAt,
      last_seen: session.lastSeen
    };
  });

  // GET /sessions/:id/qr — get QR code
  fastify.get('/:id/qr', {
    schema: {
      tags: ['Sessions'],
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
            qr: { type: 'string', nullable: true },
            status: { type: 'string' }
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

    if (!live) {
      const result = await createSession(session.id, request.user.id);
      if (result.qr) {
        const qrBase64 = await QRCode.toDataURL(result.qr);
        return { qr: qrBase64, status: result.status };
      }
      return { qr: null, status: result.status };
    }

    if (live.qr) {
      const qrBase64 = await QRCode.toDataURL(live.qr);
      return { qr: qrBase64, status: live.status };
    }

    return { qr: null, status: live.status };
  });

  // DELETE /sessions/:id
  fastify.delete('/:id', {
    schema: {
      tags: ['Sessions'],
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
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    await deleteSession(session.id);
    await prisma.session.delete({ where: { id: session.id } });

    return { message: 'Session deleted' };
  });

  // POST /sessions/:id/webhook — set webhook URL
  fastify.post('/:id/webhook', {
    schema: {
      tags: ['Sessions'],
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
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            webhook_url: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { url } = request.body || {};

    if (!url) return reply.code(400).send({ error: 'url is required' });

    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: { webhookUrl: url }
    });

    return { webhook_url: updated.webhookUrl, message: 'Webhook updated' };
  });

  // POST /sessions/:id/profile-picture
  fastify.post('/:id/profile-picture', {
    schema: {
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      consumes: ['multipart/form-data'],
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
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const buffer = await data.toBuffer();

    await live.socket.updateProfilePicture(
      live.socket.user.id,
      buffer
    );

    return { message: 'Profile picture updated' };
  });

  // POST /sessions/:id/status — set status/about
  fastify.post('/:id/status', {
    schema: {
      tags: ['Sessions'],
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
        required: ['text'],
        properties: {
          text: { type: 'string' }
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
    const { text } = request.body || {};
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = getSession(session.id);
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    if (text) {
      await live.socket.updateProfileStatus(text);
      return { message: 'Status updated' };
    }

    return reply.code(400).send({ error: 'text is required' });
  });

  // POST /sessions/:id/restart
  fastify.post('/:id/restart', {
    schema: {
      tags: ['Sessions'],
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
            status: { type: 'string' },
            qr: { type: 'string', nullable: true }
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
    if (live) {
      try { live.socket.end(undefined); } catch {}
    }

    await new Promise(r => setTimeout(r, 1000));
    const result = await createSession(session.id, request.user.id);

    let qrBase64 = null;
    if (result.qr) {
      qrBase64 = await QRCode.toDataURL(result.qr);
    }

    return { status: result.status, qr: qrBase64 };
  });
}
