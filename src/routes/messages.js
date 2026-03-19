import { prisma } from '../db/client.js';
import { sendText, sendMedia, sendMultipleMedia } from '../services/messageSender.js';
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

  // POST /sessions/:id/send-media — send single media (multipart)
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
      consumes: ['multipart/form-data'],
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

    // Get all form data including files
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    // Get fields from multipart data
    const to = data.fields.to?.value || data.fields.to;
    const caption = data.fields.caption?.value || data.fields.caption || '';
    const reply_to = data.fields.reply_to?.value || data.fields.reply_to || null;

    if (!to) return reply.code(400).send({ error: 'to (phone number) is required' });

    try {
      const buffer = await data.toBuffer();
      const result = await sendMedia(
        session.id,
        to,
        buffer,
        data.mimetype,
        data.filename,
        caption,
        reply_to
      );
      return { message_id: result.key?.id, status: 'sent' };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /sessions/:id/send-multiple-media — send multiple media files (multipart)
  fastify.post('/:id/send-multiple-media', {
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
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            sent: { type: 'integer', description: 'Number of media sent' },
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Message IDs for each sent media'
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

    // Get fields from body - with attachFieldsToBody, fields have .value property
    let to = request.body?.to;
    let caption = request.body?.caption || '';
    let reply_to = request.body?.reply_to || null;

    // Extract value from field object (attachFieldsToBody format)
    if (to && typeof to === 'object' && to.value !== undefined) {
      to = to.value;
    }
    if (caption && typeof caption === 'object' && caption.value !== undefined) {
      caption = caption.value;
    }
    if (reply_to && typeof reply_to === 'object' && reply_to.value !== undefined) {
      reply_to = reply_to.value;
    }

    console.log('[SEND-MULTIPLE] Parsed - to:', to, 'caption:', caption);

    if (!to) {
      return reply.code(400).send({ error: 'to (phone number) is required' });
    }

    // Get files from body
    const files = [];
    if (request.body?.files) {
      const filesArray = Array.isArray(request.body.files) ? request.body.files : [request.body.files];
      for (const fileField of filesArray) {
        if (fileField && fileField.file) {
          try {
            const buffer = await fileField.toBuffer();
            files.push({
              buffer,
              mimetype: fileField.mimetype,
              filename: fileField.filename
            });
            console.log('[SEND-MULTIPLE] File buffered:', fileField.filename, buffer.length, 'bytes');
          } catch (err) {
            console.error('[SEND-MULTIPLE] Failed to buffer file:', err.message);
          }
        }
      }
    }

    // Fallback: try request.files()
    if (files.length === 0) {
      console.log('[SEND-MULTIPLE] No files from body, trying request.files()...');
      const fileParts = request.files();
      for await (const part of fileParts) {
        if (part.filename) {
          try {
            const buffer = await part.toBuffer();
            files.push({
              buffer,
              mimetype: part.mimetype,
              filename: part.filename
            });
            console.log('[SEND-MULTIPLE] File buffered from parts:', part.filename, buffer.length, 'bytes');
          } catch (err) {
            console.error('[SEND-MULTIPLE] Failed to buffer file from parts:', err.message);
          }
        }
      }
    }

    console.log('[SEND-MULTIPLE] Total files:', files.length);

    if (files.length === 0) {
      return reply.code(400).send({ error: 'No files uploaded' });
    }

    try {
      console.log('[SEND-MULTIPLE] Calling sendMultipleMedia...');
      const results = await sendMultipleMedia(session.id, to, files, caption, reply_to);
      console.log('[SEND-MULTIPLE] Completed, sent:', results.length, 'files');
      return {
        sent: results.length,
        message_ids: results.map(r => r.key?.id)
      };
    } catch (err) {
      console.error('[SEND-MULTIPLE] Route error:', err.message);
      console.error('[SEND-MULTIPLE] Stack:', err.stack);
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
