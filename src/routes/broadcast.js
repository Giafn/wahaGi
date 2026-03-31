import { prisma } from '../db/client.js';
import { sendText, sendMedia, toJID } from '../services/messageSender.js';
import { getSession } from '../services/sessionManager.js';

export async function broadcastRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/:id/broadcast', {
    schema: {
      tags: ['Broadcast'],
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
        required: ['recipients'],
        properties: {
          recipients: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Array of phone numbers (with country code, no + or @)'
          },
          text: {
            type: 'string',
            description: 'Plain text message (use this OR media, not both)'
          },
          media: {
            type: 'object',
            description: 'Media file to send (use this OR text, not both)',
            properties: {
              base64: { type: 'string', description: 'Base64 encoded file data' },
              mimetype: { type: 'string', description: 'MIME type (e.g., image/jpeg, video/mp4, application/pdf)' },
              caption: { type: 'string', nullable: true, description: 'Caption for the media' },
              filename: { type: 'string', nullable: true, description: 'Filename for documents' }
            }
          },
          gap_delays: {
            type: 'object',
            description: 'Delay settings between messages',
            properties: {
              type: {
                type: 'string',
                enum: ['fixed', 'random'],
                default: 'fixed',
                description: 'fixed: same delay for all, random: random delay between min and max'
              },
              delay_ms: {
                type: 'integer',
                minimum: 0,
                maximum: 60000,
                description: 'Fixed delay in milliseconds (for type=fixed)'
              },
              min_delay_ms: {
                type: 'integer',
                minimum: 0,
                maximum: 60000,
                description: 'Minimum delay in milliseconds (for type=random)'
              },
              max_delay_ms: {
                type: 'integer',
                minimum: 0,
                maximum: 60000,
                description: 'Maximum delay in milliseconds (for type=random)'
              }
            }
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            sent: { type: 'integer' },
            failed: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  recipient: { type: 'string' },
                  status: { type: 'string' },
                  message_id: { type: 'string', nullable: true },
                  error: { type: 'string', nullable: true }
                }
              }
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

    const live = getSession(session.id);
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    const { recipients, text, media, gap_delays } = request.body || {};

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return reply.code(400).send({ error: 'recipients array is required and must not be empty' });
    }

    if (!text && !media) {
      return reply.code(400).send({ error: 'Either text or media is required' });
    }

    if (text && media) {
      return reply.code(400).send({ error: 'Provide either text or media, not both' });
    }

    let delayConfig = { type: 'fixed', delay_ms: 1000 };
    if (gap_delays) {
      if (gap_delays.type === 'random') {
        if (!gap_delays.min_delay_ms || !gap_delays.max_delay_ms) {
          return reply.code(400).send({ error: 'min_delay_ms and max_delay_ms are required for random delays' });
        }
        delayConfig = {
          type: 'random',
          min_delay_ms: gap_delays.min_delay_ms,
          max_delay_ms: gap_delays.max_delay_ms
        };
      } else {
        delayConfig = { type: 'fixed', delay_ms: gap_delays.delay_ms || 1000 };
      }
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const cleanNumber = recipient.replace(/[^0-9]/g, '');
      const jid = toJID(cleanNumber);

      try {
        let result;
        if (text) {
          result = await sendText(session.id, cleanNumber, text);
        } else if (media) {
          if (!media.base64 || !media.mimetype) {
            results.push({
              recipient: cleanNumber,
              status: 'failed',
              message_id: null,
              error: 'media.base64 and media.mimetype are required'
            });
            failed++;
            continue;
          }
          result = await sendMedia(
            session.id,
            cleanNumber,
            media.base64,
            media.mimetype,
            media.caption || null,
            media.filename || null
          );
        }

        results.push({
          recipient: cleanNumber,
          status: 'sent',
          message_id: result?.key?.id || null,
          error: null
        });
        sent++;
      } catch (err) {
        results.push({
          recipient: cleanNumber,
          status: 'failed',
          message_id: null,
          error: err.message
        });
        failed++;
      }

      const delayMs = getDelayMs(delayConfig);
      if (delayMs > 0 && recipients.indexOf(recipient) < recipients.length - 1) {
        await sleep(delayMs);
      }
    }

    return {
      total: recipients.length,
      sent,
      failed,
      results
    };
  });
}

function getDelayMs(delayConfig) {
  if (delayConfig.type === 'random') {
    return Math.floor(
      Math.random() * (delayConfig.max_delay_ms - delayConfig.min_delay_ms + 1) +
      delayConfig.min_delay_ms
    );
  }
  return delayConfig.delay_ms || 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
