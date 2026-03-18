import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../db/client.js';
import { dispatchWebhook } from './webhook.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const AUTH_DIR = process.env.AUTH_DIR || './auth';

// In-memory registry: sessionId -> { socket, qr, status }
const registry = new Map();

export function getSession(sessionId) {
  return registry.get(sessionId);
}

export function getAllActiveSessions() {
  return [...registry.entries()].map(([id, sess]) => ({ id, status: sess.status }));
}

export async function createSession(sessionId, userId) {
  // If already running, return existing
  if (registry.has(sessionId)) {
    const existing = registry.get(sessionId);
    return { status: existing.status, qr: existing.qr };
  }

  return await _initSocket(sessionId, userId);
}

export async function deleteSession(sessionId) {
  const entry = registry.get(sessionId);
  if (entry) {
    try {
      await entry.socket.logout();
    } catch {}
    try {
      entry.socket.end(undefined);
    } catch {}
    registry.delete(sessionId);
  }

  // Remove auth files
  const authPath = path.join(AUTH_DIR, sessionId);
  try {
    await fs.rm(authPath, { recursive: true, force: true });
  } catch {}
}

export async function restoreAllSessions() {
  // On startup, reload all connected sessions from DB
  try {
    const sessions = await prisma.session.findMany({
      where: { status: { in: ['connected', 'connecting'] } }
    });

    for (const session of sessions) {
      const authPath = path.join(AUTH_DIR, session.id);
      try {
        await fs.access(authPath);
        await _initSocket(session.id, session.userId);
      } catch {
        // Auth dir missing, mark as disconnected
        await prisma.session.update({
          where: { id: session.id },
          data: { status: 'disconnected' }
        });
      }
    }
  } catch (err) {
    console.error('Failed to restore sessions:', err.message);
  }
}

async function _initSocket(sessionId, userId) {
  const authPath = path.join(AUTH_DIR, sessionId);
  await fs.mkdir(authPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const entry = {
    socket: null,
    status: 'connecting',
    qr: null,
    userId,
    retryCount: 0
  };

  registry.set(sessionId, entry);

  const socket = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ['Baileys API', 'Chrome', '120.0.0'],
    generateHighQualityLinkPreview: false
  });

  entry.socket = socket;

  // ---- QR ----
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      entry.qr = qr;
      entry.status = 'qr';
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'qr' }
      }).catch(() => {});
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      entry.status = 'disconnected';
      entry.qr = null;

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'disconnected' }
      }).catch(() => {});

      await dispatchWebhook(sessionId, { event: 'session.update', status: 'disconnected', reason });

      if (shouldReconnect && entry.retryCount < 5) {
        entry.retryCount++;
        const delay = Math.min(1000 * Math.pow(2, entry.retryCount), 30000);
        setTimeout(() => _initSocket(sessionId, userId), delay);
      } else if (reason === DisconnectReason.loggedOut) {
        registry.delete(sessionId);
        await fs.rm(authPath, { recursive: true, force: true }).catch(() => {});
      }
    }

    if (connection === 'open') {
      entry.status = 'connected';
      entry.qr = null;
      entry.retryCount = 0;

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'connected', lastSeen: new Date() }
      }).catch(() => {});

      await dispatchWebhook(sessionId, { event: 'session.update', status: 'connected' });
    }
  });

  // ---- Save creds ----
  socket.ev.on('creds.update', saveCreds);

  // ---- Incoming messages ----
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const msgType = getMessageType(msg);
      const payload = buildWebhookPayload(msg, msgType, sessionId);

      await dispatchWebhook(sessionId, payload);
    }
  });

  return { status: entry.status, qr: entry.qr };
}

function getMessageType(msg) {
  if (!msg.message) return 'unknown';
  const keys = Object.keys(msg.message);
  if (keys.includes('conversation') || keys.includes('extendedTextMessage')) return 'text';
  if (keys.includes('imageMessage')) return 'image';
  if (keys.includes('videoMessage')) return 'video';
  if (keys.includes('documentMessage')) return 'document';
  if (keys.includes('audioMessage')) return 'audio';
  if (keys.includes('stickerMessage')) return 'sticker';
  return keys[0] || 'unknown';
}

function buildWebhookPayload(msg, type, sessionId) {
  const base = {
    event: 'message.received',
    session_id: sessionId,
    from: msg.key.remoteJid,
    message_id: msg.key.id,
    type,
    timestamp: msg.messageTimestamp
  };

  if (type === 'text') {
    base.text = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || '';
  }

  if (['image', 'video', 'document', 'audio'].includes(type)) {
    const mediaMsg = msg.message?.[`${type}Message`];
    base.mimetype = mediaMsg?.mimetype;
    base.filename = mediaMsg?.fileName;
    base.caption = mediaMsg?.caption;
  }

  return base;
}
