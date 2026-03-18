import { prisma } from '../db/client.js';
import { getSession } from '../services/sessionManager.js';

export async function chatRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /sessions/:id/chats
  fastify.get('/:id/chats', async (request, reply) => {
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const live = getSession(session.id);
    if (!live || live.status !== 'connected') {
      return reply.code(400).send({ error: 'Session not connected' });
    }

    const chats = live.store?.chats?.all() || [];
    return chats.slice(0, 100).map(chat => ({
      id: chat.id,
      name: chat.name,
      unread_count: chat.unreadCount,
      last_message_time: chat.conversationTimestamp
    }));
  });
}
