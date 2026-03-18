import { prisma } from '../db/client.js';
import { createSession, deleteSession, getSession } from '../services/sessionManager.js';
import QRCode from 'qrcode';

export async function sessionRoutes(fastify) {
  // All routes require auth
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /sessions — create new session
  fastify.post('/', async (request, reply) => {
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

  // GET /sessions — list all sessions for user
  fastify.get('/', async (request) => {
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

  // GET /sessions/:id — get single session status
  fastify.get('/:id', async (request, reply) => {
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

  // GET /sessions/:id/qr — get current QR code
  fastify.get('/:id/qr', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = getSession(session.id);

    if (!live) {
      // Start session if not running
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
  fastify.delete('/:id', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });

    if (!session) return reply.code(404).send({ error: 'Session not found' });

    await deleteSession(session.id);
    await prisma.session.delete({ where: { id: session.id } });

    return { message: 'Session deleted' };
  });

  // POST /sessions/:id/webhook — set webhook URL
  fastify.post('/:id/webhook', async (request, reply) => {
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
  fastify.post('/:id/profile-picture', async (request, reply) => {
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
  fastify.post('/:id/status', async (request, reply) => {
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
  fastify.post('/:id/restart', async (request, reply) => {
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
