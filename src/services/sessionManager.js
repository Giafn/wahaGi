import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../db/client.js';
import { dispatchWebhook } from './webhook.js';
import pino from 'pino';

const logger = pino({ level: process.env.DEBUG === 'true' ? 'info' : 'silent' });
const AUTH_DIR = process.env.AUTH_DIR || './auth';

// Helper logging - always log to console when DEBUG=true
const log = (msg, ...args) => {
  if (process.env.DEBUG === 'true') {
    console.log(`[wahaGI] ${msg}`, ...args);
  }
};

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
      where: { status: { in: ['connected', 'qr'] } }
    });

    log(`Restoring ${sessions.length} session(s)...`);

    for (const session of sessions) {
      const authPath = path.join(AUTH_DIR, session.id);
      try {
        await fs.access(authPath);
        await _initSocket(session.id, session.userId);
        log(`Session ${session.id} restored`);
      } catch (err) {
        log(`Failed to restore session ${session.id}: ${err.message}`);
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
      log(`📱 QR Code received for session ${sessionId}`);
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

      log(`❌ Connection closed. Reason: ${reason}, Should reconnect: ${shouldReconnect}`);

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
        log(`🔄 Reconnecting in ${delay}ms (attempt ${entry.retryCount}/5)`);
        setTimeout(() => _initSocket(sessionId, userId), delay);
      } else if (reason === DisconnectReason.loggedOut) {
        log(`🚫 Session logged out, removing from registry`);
        registry.delete(sessionId);
        await fs.rm(authPath, { recursive: true, force: true }).catch(() => {});
      }
    }

    if (connection === 'open') {
      log(`✅ Connection opened for session ${sessionId}`);
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
    log(`📨 Message event: type=${type}, count=${messages.length}`);

    // Only process notify type (new messages)
    if (type !== 'notify' && type !== 'append') {
      log(`⚠️ Skipping message type: ${type}`);
      return;
    }

    for (const msg of messages) {
      if (msg.key.fromMe) {
        log(`⏭️ Skipping message from me`);
        continue;
      }

      const jid = msg.key.remoteJid;
      const msgType = getMessageType(msg);
      const payload = await buildWebhookPayload(msg, msgType, sessionId);

      log(`🔔 Dispatching webhook: event=${payload.event}, from=${jid}, type=${msgType}`);
      await dispatchWebhook(sessionId, payload);
    }
  });

  // Also handle message updates (for status changes)
  socket.ev.on('messages.update', async (updates) => {
    log(`📝 Messages update: ${updates?.length} updates`);
    for (const update of updates) {
      if (update.update?.status) {
        log(`📊 Message status update: ${update.key.id} -> ${update.update.status}`);
      }
    }
  });

  // Also listen for m-receipt.update (message status)
  socket.ev.on('m-receipt.update', async (update) => {
    log('Receipt update:', update);
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

async function buildWebhookPayload(msg, type, sessionId) {
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

    // Download and save media, include URL in webhook
    try {
      const mediaInfo = await downloadAndSaveMedia(msg, sessionId);
      base.media_url = mediaInfo.fileUrl;
      base.media_path = mediaInfo.filePath;
      base.media_size = mediaInfo.size;
      log(`💾 Media saved: ${mediaInfo.fileUrl}`);
    } catch (err) {
      log(`❌ Failed to download media: ${err.message}`);
    }
  }

  return base;
}

/**
 * Download media from message and save to file
 */
async function downloadAndSaveMedia(msg, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger: undefined, reuploadRequest: session.socket.updateMediaMessage }
  );

  if (!buffer) {
    throw new Error('Failed to download media');
  }

  const mimetype = msg.message?.imageMessage?.mimetype ||
                   msg.message?.videoMessage?.mimetype ||
                   msg.message?.documentMessage?.mimetype ||
                   msg.message?.audioMessage?.mimetype ||
                   'application/octet-stream';

  const ext = getExtension(mimetype);
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

  // Save to MEDIA_DIR (not AUTH_DIR) so it's accessible via static file serving
  const mediaDir = process.env.MEDIA_DIR || './media';
  const filePath = path.join(mediaDir, 'incoming', filename);

  await fs.mkdir(path.join(mediaDir, 'incoming'), { recursive: true });
  await fs.writeFile(filePath, buffer);

  const fileUrl = `${process.env.PUBLIC_URL || 'http://localhost:3021'}/media/files/incoming/${filename}`;

  return {
    filename,
    filePath,
    fileUrl,
    mimetype,
    size: buffer.length
  };
}

function getExtension(mimetype) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/xlsx': 'xlsx',
    'application/docx': 'docx'
  };
  return map[mimetype] || 'bin';
}
