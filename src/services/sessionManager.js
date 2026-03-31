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

// In-memory registry: sessionId -> { socket, qr, status }
const registry = new Map();

// Track processed message IDs to prevent duplicates
const processedMessages = new Map();

/**
 * Normalize JID to LID format (WhatsApp ID)
 * Extracts the ID part from JID (e.g., 628xxx@s.whatsapp.net -> 628xxx, 231xxx@lid -> 231xxx)
 *
 * @param {string} jid - WhatsApp JID (e.g., 628xxx@s.whatsapp.net or 231xxx@lid)
 * @returns {string} Normalized LID
 */
export function normalizeJID(jid) {
  if (!jid) return '';
  return jid.split('@')[0].replace(/^\+/, '').replace(/[^0-9]/g, '');
}

/**
 * Convert LID to proper JID format for sending
 */
function toJID(lid) {
  if (!lid) return '';
  const clean = lid.replace(/[^0-9]/g, '');
  if (clean.includes('@')) return clean;
  return `${clean}@s.whatsapp.net`;
}

// Helper logging - always log to console when DEBUG=true
const log = (msg, ...args) => {
  if (process.env.DEBUG === 'true') {
    console.log(`[wahaGI] ${msg}`, ...args);
  }
};

export function getSession(sessionId) {
  return registry.get(sessionId);
}

export function getAllActiveSessions() {
  return [...registry.entries()].map(([id, sess]) => ({ id, status: sess.status }));
}

export async function createSession(sessionId, userId) {
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
  const authPath = path.join(AUTH_DIR, sessionId);
  try {
    await fs.rm(authPath, { recursive: true, force: true });
  } catch {}
}

export async function disconnectSession(sessionId) {
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
  // Update session status in database
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'disconnected' }
  }).catch(() => {});
}

export async function restoreAllSessions() {
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
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    syncFullAppState: false
  });

  entry.socket = socket;

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

      // Set presence to unavailable once after connect to hide online status
      // This won't affect message delivery as we don't toggle it repeatedly
      setTimeout(async () => {
        try {
          await socket.sendPresenceUpdate('unavailable');
          log(`🔒 Presence set to unavailable (hidden online status)`);
        } catch (err) {
          log(`⚠️ Failed to set presence: ${err.message}`);
        }
      }, 3000);

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'connected', lastSeen: new Date() }
      }).catch(() => {});
    }
  });

  socket.ev.on('creds.update', saveCreds);

  // Clean up old processed messages every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of processedMessages.entries()) {
      if (now - timestamp > 60000) {
        processedMessages.delete(key);
      }
    }
  }, 60000);

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    log(`📨 Message event: type=${type}, count=${messages.length}`);

    if (type !== 'notify' && type !== 'append') {
      log(`⚠️ Skipping message type: ${type}`);
      return;
    }

    for (const msg of messages) {
      const msgId = msg.key?.id;
      const jid = msg.key.remoteJid;
      const msgType = getMessageType(msg);
      const isFromMe = msg.key.fromMe;

      const processKey = `${sessionId}:${msgId}`;
      if (processedMessages.has(processKey)) {
        log(`⏭️ Skipping duplicate message: ${msgId}`);
        continue;
      }
      processedMessages.set(processKey, Date.now());

      const lid = normalizeJID(jid);
      const isGroup = jid.includes('@g.us');

      log(`🔍 Processing message: jid=${jid}, lid=${lid}, isGroup=${isGroup}, isFromMe=${isFromMe}`);

      await saveChatHistoryWithLID(sessionId, jid, msg, msgType, lid);

      const payload = await buildWebhookPayload(msg, msgType, sessionId, lid, isFromMe);
      log(`🔔 Dispatching webhook: event=${payload.event}, from=${payload.from}, from_me=${payload.from_me}, conversation_id=${payload.conversation_id}, type=${msgType}`);
      await dispatchWebhook(sessionId, payload);
    }
  });

  socket.ev.on('messages.update', async (updates) => {
    log(`📝 Messages update: ${updates?.length} updates`);

    for (const update of updates) {
      if (!update.update?.message) continue;

      const msgId = update.key?.id;
      const jid = update.key?.remoteJid;
      const isFromMe = update.key?.fromMe;

      log(`✏️ Message edited: id=${msgId}, from=${jid}, isFromMe=${isFromMe}`);

      try {
        const updatedMessage = update.update.message;
        const messageText = updatedMessage?.conversation ||
                           updatedMessage?.extendedTextMessage?.text ||
                           '[Edited media/caption]';

        const existingMsg = await prisma.chatHistory.findFirst({
          where: { sessionId, message_id: msgId }
        });

        if (existingMsg) {
          await prisma.chatHistory.update({
            where: { id: existingMsg.id },
            data: { message: `${messageText} (edited)` }
          });
          log(`✅ Updated message ${msgId} in database`);
        } else {
          log(`⚠️ Message ${msgId} not found in DB, skipping update`);
        }
      } catch (err) {
        log(`❌ Error updating message: ${err.message}`);
      }
    }
  });

  socket.ev.on('m-receipt.update', async (update) => {
    log('Receipt update:', update);
  });

  return { status: entry.status, qr: entry.qr };
}

function getMessageType(msg) {
  if (!msg.message) {
    log(`⚠️ Message has no message object: ${JSON.stringify(msg.key)}`);
    return 'text';
  }

  const keys = Object.keys(msg.message);

  if (keys.includes('conversation')) return 'text';
  if (keys.includes('extendedTextMessage')) return 'text';
  if (keys.includes('imageMessage')) return 'image';
  if (keys.includes('videoMessage')) return 'video';
  if (keys.includes('documentMessage')) return 'document';
  if (keys.includes('audioMessage')) return 'audio';
  if (keys.includes('stickerMessage')) return 'sticker';
  if (keys.includes('contactMessage')) return 'contact';
  if (keys.includes('contactsArrayMessage')) return 'contact';
  if (keys.includes('locationMessage')) return 'location';
  if (keys.includes('liveLocationMessage')) return 'location';

  if (keys.includes('viewOnceMessage')) {
    const inner = msg.message.viewOnceMessage.message;
    if (inner) {
      const innerKeys = Object.keys(inner);
      if (innerKeys.includes('imageMessage')) return 'image_viewonce';
      if (innerKeys.includes('videoMessage')) return 'video_viewonce';
    }
    return 'viewonce';
  }

  if (keys.includes('reactionMessage')) return 'reaction';
  if (keys.includes('pollCreationMessage')) return 'poll';
  if (keys.includes('pollUpdateMessage')) return 'poll';

  if (keys.includes('protocolMessage')) {
    const protocol = msg.message.protocolMessage;
    if (protocol.type === 0) return 'revoke';
    return 'protocol';
  }

  log(`⚠️ Unknown message type. Keys: ${keys.join(', ')}`);
  return 'text';
}

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
  const mediaDir = process.env.MEDIA_DIR || './media';
  const filePath = path.join(mediaDir, 'incoming', filename);

  await fs.mkdir(path.join(mediaDir, 'incoming'), { recursive: true });
  await fs.writeFile(filePath, buffer);

  const fileUrl = `${process.env.PUBLIC_URL || 'http://localhost:3021'}/media/files/incoming/${filename}`;

  return { filename, filePath, fileUrl, mimetype, size: buffer.length };
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

async function saveChatHistoryWithLID(sessionId, jid, msg, msgType, lid) {
  try {
    let messageText = '';

    if (msgType === 'text') {
      messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    } else if (msgType === 'image') {
      const imageMsg = msg.message?.imageMessage;
      messageText = imageMsg?.caption || '[Image]';
    } else if (msgType === 'video') {
      const videoMsg = msg.message?.videoMessage;
      messageText = videoMsg?.caption || '[Video]';
    } else if (msgType === 'document') {
      const docMsg = msg.message?.documentMessage;
      messageText = docMsg?.caption || `[Document: ${docMsg?.fileName || 'file'}]`;
    } else if (msgType === 'audio') {
      messageText = '[Audio]';
    } else if (msgType === 'sticker') {
      messageText = '[Sticker]';
    } else {
      messageText = `[${msgType}]`;
    }

    log(`💾 Saving chat: lid=${lid}, type=${msgType}, message=${messageText.substring(0, 50)}`);

    await prisma.chatHistory.create({
      data: {
        sessionId,
        messageId: msg.key?.id,
        from: lid,
        message: messageText,
        type: msgType,
        isFromMe: false,
        timestamp: new Date(msg.messageTimestamp * 1000)
      }
    });

    await prisma.chatHistory.deleteMany({
      where: {
        sessionId,
        from: lid,
        createdAt: {
          lt: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))
        }
      }
    });

    const existingChat = await prisma.chat.findUnique({
      where: { sessionId_lid: { sessionId, lid } }
    });

    if (existingChat) {
      await prisma.chat.update({
        where: { id: existingChat.id },
        data: {
          unreadCount: { increment: 1 },
          lastMessageTime: new Date(msg.messageTimestamp * 1000)
        }
      });
    } else {
      await prisma.chat.create({
        data: {
          sessionId,
          lid,
          name: lid,
          unreadCount: 1,
          lastMessageTime: new Date(msg.messageTimestamp * 1000)
        }
      });
    }

    log(`💾 Chat history saved for LID ${lid}`);
  } catch (err) {
    log(`❌ Error saving chat history: ${err.message}`);
    console.error(err.stack);
  }
}

async function buildWebhookPayload(msg, type, sessionId, lid, isFromMe = false) {
  const jid = msg.key.remoteJid;
  const isGroup = jid.includes('@g.us');

  const senderLid = isGroup
    ? msg.key.participant
    : jid;

  const base = {
    event: isFromMe ? 'message.sent' : 'message.received',
    session_id: sessionId,
    conversation_id: isGroup ? jid : lid,
    from: senderLid,
    from_me: isFromMe,
    is_group: isGroup,
    message_id: msg.key.id,
    type,
    timestamp: msg.messageTimestamp
  };

  if (type === 'text') {
    base.text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                '';
  }

  if (type === 'image' || type === 'image_viewonce') {
    const imageMsg = msg.message?.imageMessage || msg.message?.viewOnceMessage?.message?.imageMessage;
    if (imageMsg) {
      base.mimetype = imageMsg.mimetype;
      base.filename = imageMsg.fileName || `image_${Date.now()}.jpg`;
      base.caption = imageMsg.caption || '';
      base.width = imageMsg.width;
      base.height = imageMsg.height;

      try {
        const mediaInfo = await downloadAndSaveMedia(msg, sessionId);
        base.media_url = mediaInfo.fileUrl;
        base.media_path = mediaInfo.filePath;
        base.media_size = mediaInfo.size;
        log(`💾 Media saved: ${mediaInfo.fileUrl}`);
      } catch (err) {
        log(`❌ Failed to download media: ${err.message}`);
        base.media_error = err.message;
      }
    }
  }

  if (type === 'video' || type === 'video_viewonce') {
    const videoMsg = msg.message?.videoMessage || msg.message?.viewOnceMessage?.message?.videoMessage;
    if (videoMsg) {
      base.mimetype = videoMsg.mimetype;
      base.filename = videoMsg.fileName || `video_${Date.now()}.mp4`;
      base.caption = videoMsg.caption || '';
      base.width = videoMsg.width;
      base.height = videoMsg.height;
      base.duration = videoMsg.seconds;

      try {
        const mediaInfo = await downloadAndSaveMedia(msg, sessionId);
        base.media_url = mediaInfo.fileUrl;
        base.media_path = mediaInfo.filePath;
        base.media_size = mediaInfo.size;
      } catch (err) {
        log(`❌ Failed to download media: ${err.message}`);
        base.media_error = err.message;
      }
    }
  }

  if (type === 'document') {
    const docMsg = msg.message?.documentMessage;
    if (docMsg) {
      base.mimetype = docMsg.mimetype;
      base.filename = docMsg.fileName || `document_${Date.now()}`;
      base.caption = docMsg.caption || '';
      base.media_size = docMsg.fileLength?.low || docMsg.fileLength;

      try {
        const mediaInfo = await downloadAndSaveMedia(msg, sessionId);
        base.media_url = mediaInfo.fileUrl;
        base.media_path = mediaInfo.filePath;
      } catch (err) {
        log(`❌ Failed to download media: ${err.message}`);
        base.media_error = err.message;
      }
    }
  }

  if (type === 'audio') {
    const audioMsg = msg.message?.audioMessage;
    if (audioMsg) {
      base.mimetype = audioMsg.mimetype;
      base.duration = audioMsg.seconds;
      base.filename = `audio_${Date.now()}.ogg`;

      try {
        const mediaInfo = await downloadAndSaveMedia(msg, sessionId);
        base.media_url = mediaInfo.fileUrl;
        base.media_path = mediaInfo.filePath;
        base.media_size = mediaInfo.size;
      } catch (err) {
        log(`❌ Failed to download media: ${err.message}`);
        base.media_error = err.message;
      }
    }
  }

  if (type === 'sticker') {
    const stickerMsg = msg.message?.stickerMessage;
    if (stickerMsg) {
      base.mimetype = stickerMsg.mimetype;
      base.width = stickerMsg.width;
      base.height = stickerMsg.height;
      base.filename = `sticker_${Date.now()}.webp`;
    }
  }

  if (type === 'reaction') {
    const reactionMsg = msg.message?.reactionMessage;
    if (reactionMsg) {
      base.reaction = reactionMsg.text;
      base.key = reactionMsg.key;
    }
  }

  if (type === 'location') {
    const locationMsg = msg.message?.locationMessage || msg.message?.liveLocationMessage;
    if (locationMsg) {
      base.latitude = locationMsg.latitudeDegrees;
      base.longitude = locationMsg.longitudeDegrees;
      base.name = locationMsg.name;
      base.address = locationMsg.address;
    }
  }

  return base;
}

/**
 * Get chat list for a session from database
 */
export async function getChatList(sessionId) {
  const chats = await prisma.chat.findMany({
    where: { sessionId },
    orderBy: [{ lastMessageTime: 'desc' }]
  });

  return chats.map(chat => ({
    id: chat.id,
    lid: chat.lid,
    name: chat.name || chat.lid,
    unread_count: chat.unreadCount,
    last_chat: chat.lastMessageTime?.getTime() || null
  }));
}

/**
 * Get chat history for a specific LID
 */
export async function getChatHistory(sessionId, lid, limit = 20) {
  const messages = await prisma.chatHistory.findMany({
    where: { sessionId, from: lid },
    orderBy: [{ timestamp: 'desc' }],
    take: parseInt(limit)
  });

  return messages.map(msg => ({
    id: msg.id,
    from: msg.from,
    lid: msg.from,
    message: msg.message,
    type: msg.type,
    is_from_me: msg.isFromMe,
    timestamp: msg.timestamp.getTime()
  })).reverse();
}

/**
 * Get messages by LID across all sessions
 */
export async function getMessagesByLID(lid, sessionId = null, limit = 50) {
  const where = { from: lid };
  if (sessionId) {
    where.sessionId = sessionId;
  }

  const messages = await prisma.chatHistory.findMany({
    where,
    orderBy: [{ timestamp: 'desc' }],
    take: parseInt(limit)
  });

  // Get session info separately since no relation defined
  const sessionIds = [...new Set(messages.map(m => m.sessionId))];
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds } },
    select: { id: true, name: true }
  });
  const sessionMap = new Map(sessions.map(s => [s.id, s]));

  return messages.map(msg => ({
    id: msg.id,
    session_id: msg.sessionId,
    session_name: sessionMap.get(msg.sessionId)?.name || null,
    from: msg.from,
    lid: msg.from,
    message: msg.message,
    type: msg.type,
    is_from_me: msg.isFromMe,
    timestamp: msg.timestamp.getTime()
  }));
}
