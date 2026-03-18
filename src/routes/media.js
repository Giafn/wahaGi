import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import { prisma } from '../db/client.js';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

export async function mediaRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /media/upload — upload one or multiple files
  fastify.post('/upload', {
    schema: {
      tags: ['Media'],
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
      body: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'string',
              format: 'binary'
            },
            description: 'One or more files to upload'
          }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            media_ids: {
              type: 'array',
              items: { type: 'string', format: 'uuid' }
            },
            count: { type: 'integer' }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const mediaIds = [];
    const parts = request.files();

    for await (const part of parts) {
      const ext = mime.extension(part.mimetype) || path.extname(part.filename).slice(1) || 'bin';
      const filename = part.filename || `upload.${ext}`;
      const id = uuidv4();
      const storedFilename = `${id}.${ext}`;
      const filePath = path.join(MEDIA_DIR, storedFilename);

      // Get file size while writing
      let size = 0;
      const chunks = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
        size += chunk.length;
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(filePath, buffer);

      const media = await prisma.media.create({
        data: {
          id,
          userId: request.user.id,
          filename,
          path: filePath,
          mimeType: part.mimetype,
          size
        }
      });

      mediaIds.push(media.id);
    }

    if (mediaIds.length === 0) {
      return reply.code(400).send({ error: 'No files uploaded' });
    }

    return reply.code(201).send({ media_ids: mediaIds, count: mediaIds.length });
  });

  // GET /media — list user's media
  fastify.get('/', {
    schema: {
      tags: ['Media'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 },
          offset: { type: 'integer', default: 0, minimum: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            media: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  filename: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'integer' },
                  url: { type: 'string', format: 'uri' },
                  createdAt: { type: 'string', format: 'date-time' }
                }
              }
            },
            total: { type: 'integer' }
          }
        }
      }
    }
  }, async (request) => {
    const { limit = 50, offset = 0 } = request.query;
    const media = await prisma.media.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
        path: false
      }
    });

    const total = await prisma.media.count({ where: { userId: request.user.id } });

    return {
      media: media.map(m => ({
        ...m,
        url: `${PUBLIC_URL}/media/files/${path.basename(m.path || '')}`
      })),
      total
    };
  });

  // GET /media/:id — get single media info
  fastify.get('/:id', {
    schema: {
      tags: ['Media'],
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
            filename: { type: 'string' },
            mime_type: { type: 'string' },
            size: { type: 'integer' },
            url: { type: 'string', format: 'uri' },
            created_at: { type: 'string', format: 'date-time' }
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
    const media = await prisma.media.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!media) return reply.code(404).send({ error: 'Media not found' });

    return {
      id: media.id,
      filename: media.filename,
      mime_type: media.mimeType,
      size: media.size,
      url: `${PUBLIC_URL}/media/files/${path.basename(media.path)}`,
      created_at: media.createdAt
    };
  });

  // DELETE /media/:id
  fastify.delete('/:id', {
    schema: {
      tags: ['Media'],
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
    const media = await prisma.media.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!media) return reply.code(404).send({ error: 'Media not found' });

    // Delete file
    try {
      await fs.unlink(media.path);
    } catch {}

    await prisma.media.delete({ where: { id: media.id } });

    return { message: 'Media deleted' };
  });
}
