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
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY_MESSAGES || '20');

// Cache for mapping LID to phone number: { [sessionId]: Map<lid, phoneNumber> }
const contactCache = new Map();

/**
 * Normalize JID to consistent format (phone number only)
 * Uses multiple methods to extract correct phone number
 *
 * @param {string} jid - WhatsApp JID (e.g., 628xxx@s.whatsapp.net or 231xxx@lid)
 * @param {string} sessionId - Session ID for cache lookup
 * @param {object} msg - Full message object for senderPn extraction
 * @returns {string} Normalized phone number
 */
export function normalizeJID(jid, sessionId = null, msg = null) {
  if (!jid) return '';

  // Method 1: Use senderPn from message (MOST RELIABLE)
  if (msg) {
    const senderPn = msg.key?.senderPn || msg.senderPn;
    if (senderPn && senderPn.includes('@s.whatsapp.net')) {
      let phone = senderPn.split('@')[0];
      phone = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');

      // Fix Indonesian mobile numbers (add missing "9" or "8")
      // Pattern: 62 + XX (area code) + 9/8 + 7-8 digits = 12-14 digits
      // Example: 6281234567890 (Telkomsel), 6289668376597 (Tri)
      if (phone.startsWith('62') && phone.length === 11 && !['8', '9'].includes(phone[2])) {
        // Insert "8" or "9" after area code if missing
        phone = phone.slice(0, 2) + '8' + phone.slice(2);
        log(`📞 Fixed senderPn: ${senderPn.split('@')[0]} → ${phone} (added missing digit)`);
      }

      log(`✅ Using senderPn: ${phone}`);
      return phone;
    }
  }

  // Method 2: Extract from JID
  let phone = jid.split('@')[0];
  phone = phone.replace(/^\+/, '').replace(/[^0-9]/g, '');

  // Method 3: Handle @lid suffix
  if (jid.includes('@lid')) {
    log(`⚠️ Detected @lid suffix: ${jid}`);

    // If we have participant field, use that instead
    if (msg?.participant || msg?.key?.participant) {
      const participant = msg.participant || msg.key.participant;
      const participantPhone = participant.split('@')[0].replace(/^\+/, '').replace(/[^0-9]/g, '');
      if (participantPhone.length >= 10 && participantPhone.length <= 15) {
        log(`✅ Using participant instead: ${participantPhone}`);
        return participantPhone;
      }
    }

    // Try to check cache
    if (sessionId && contactCache.has(sessionId)) {
      const cached = contactCache.get(sessionId).get(phone);
      if (cached) {
        log(`📞 Resolved LID ${phone} → ${cached} from cache`);
        return cached;
      }
    }

    log(`⚠️ Could not resolve @lid, keeping as: ${phone}`);
  }

  // Validate phone number length (E.164: 10-15 digits)
  if (phone.length < 10 || phone.length > 15) {
    log(`⚠️ Suspicious phone number: ${phone} (length: ${phone.length})`);
    log(`   Original JID: ${jid}`);
  }

  return phone;
}

/**
 * Update contact cache with LID to phone mapping
 */
export function updateContactCache(sessionId, lid, phoneNumber) {
  if (!contactCache.has(sessionId)) {
    contactCache.set(sessionId, new Map());
  }
  contactCache.get(sessionId).set(lid, phoneNumber);
  console.log(`[ContactCache] Updated: ${lid} → ${phoneNumber}`);
}

/**
 * Get contact from cache by LID
 */
export function getContactByLID(sessionId, lid) {
  if (!contactCache.has(sessionId)) return null;
  return contactCache.get(sessionId).get(lid);
}

/**
 * Convert phone number to proper JID format for sending
 */
function toJID(phoneNumber) {
  if (!phoneNumber) return '';
  const clean = phoneNumber.replace(/[^0-9]/g, '');
  if (clean.includes('@')) return clean;
  return `${clean}@s.whatsapp.net`;
}

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

      // Session status updates via API only - no webhook
      // await dispatchWebhook(sessionId, { event: 'session.update', status: 'disconnected', reason });

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

      // Populate contact cache from Baileys contacts
      if (entry.store?.contacts) {
        const contacts = entry.store.contacts || {};
        Object.entries(contacts).forEach(([jid, contact]) => {
          if (contact.notify && jid.includes('@')) {
            const lid = jid.split('@')[0];
            const phoneNumber = contact.notify.replace(/[^0-9]/g, '');
            if (phoneNumber.length < 15 && lid.length >= 15) {
              updateContactCache(sessionId, lid, phoneNumber);
            }
          }
        });
        log(`📇 Loaded ${Object.keys(contacts).length} contacts to cache`);
      }

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'connected', lastSeen: new Date() }
      }).catch(() => {});

      // Session status updates via API only - no webhook
      // await dispatchWebhook(sessionId, { event: 'session.update', status: 'connected' });
    }
  });

  // ---- Save creds ----
  socket.ev.on('creds.update', saveCreds);

// Track processed message IDs to prevent duplicates
const processedMessages = new Map();

// Clean up old processed messages every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > 60000) { // Remove after 1 minute
      processedMessages.delete(key);
    }
  }
}, 60000);

  // ---- Incoming messages ----
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    log(`📨 Message event: type=${type}, count=${messages.length}`);

    // Only process notify/append type (new messages)
    if (type !== 'notify' && type !== 'append') {
      log(`⚠️ Skipping message type: ${type}`);
      return;
    }

    for (const msg of messages) {
      const msgId = msg.key?.id;
      const jid = msg.key.remoteJid;
      const msgType = getMessageType(msg);
      const isFromMe = msg.key.fromMe;

      // Skip if already processed (prevent duplicates)
      const processKey = `${sessionId}:${msgId}`;
      if (processedMessages.has(processKey)) {
        log(`⏭️ Skipping duplicate message: ${msgId}`);
        continue;
      }
      processedMessages.set(processKey, Date.now());

      // Skip saving outgoing messages - already saved by sendText/sendMedia
      if (isFromMe) {
        log(`⏭️ Skipping outgoing message (already saved)`);
        continue;
      }

      // First resolve phone number from LID using enhanced normalization
      let phoneNumber = normalizeJID(jid, sessionId, msg);
      let lid = null;

      log(`🔍 Processing incoming: jid=${jid}, normalized=${phoneNumber}, length=${phoneNumber.length}`);

      // If it's still a LID (15+ digits), try multiple methods to resolve
      if (phoneNumber.length >= 15) {
        lid = phoneNumber;
        let resolved = false;

        // Method 1: Check recent outgoing messages
        log(`🔍 Method 1: Looking for recent outgoing messages...`);
        const recentOutgoing = await prisma.chatHistory.findMany({
          where: {
            sessionId,
            isFromMe: true,
            timestamp: {
              gte: new Date(Date.now() - (24 * 60 * 60 * 1000))
            }
          },
          orderBy: [{ timestamp: 'desc' }],
          take: 20,
          distinct: ['from']
        });

        log(`🔍 Found ${recentOutgoing.length} recent outgoing message(s)`);

        if (recentOutgoing.length > 0) {
          const lastOutgoingPhone = recentOutgoing[0].from;
          const lastOutgoingTime = recentOutgoing[0].timestamp;
          const msgTime = new Date(msg.messageTimestamp * 1000);
          const timeDiff = Math.abs(msgTime.getTime() - lastOutgoingTime.getTime());

          log(`🔍 Last outgoing: ${lastOutgoingPhone} at ${lastOutgoingTime.toISOString()}`);
          log(`🔍 Time diff: ${Math.round(timeDiff/1000)}s (${Math.round(timeDiff/60000)} min)`);

          if (timeDiff < 5 * 60 * 1000) {
            phoneNumber = lastOutgoingPhone;
            resolved = true;
            updateContactCache(sessionId, lid, phoneNumber);
            log(`📞 ✅ Resolved via Method 1 (recent conversation): ${lid} → ${phoneNumber}`);
          }
        }

        // Method 2: Check existing chats in database
        if (!resolved) {
          log(`🔍 Method 2: Looking for matching chat in database...`);
          const existingChats = await prisma.chat.findMany({
            where: { sessionId }
          });

          log(`🔍 Found ${existingChats.length} existing chat(s)`);

          // Check if any chat has this LID stored
          for (const chat of existingChats) {
            if (chat.lid === lid) {
              phoneNumber = chat.jid;
              resolved = true;
              log(`📞 ✅ Resolved via Method 2 (existing chat lid): ${lid} → ${phoneNumber}`);
              break;
            }
          }
        }

        // Method 3: Check Baileys contacts store
        if (!resolved) {
          log(`🔍 Method 3: Checking Baileys contacts store...`);
          const session = getSession(sessionId);
          if (session?.store?.contacts) {
            const contact = session.store.contacts[jid];
            if (contact) {
              log(`🔍 Found contact: ${JSON.stringify(contact)}`);
              // Try different contact fields for phone number
              const phoneFields = ['notify', 'name', 'verifiedName', 'subject'];
              for (const field of phoneFields) {
                if (contact[field]) {
                  const potential = contact[field].replace(/[^0-9]/g, '');
                  if (potential.length >= 10 && potential.length < 15) {
                    phoneNumber = potential;
                    resolved = true;
                    updateContactCache(sessionId, lid, phoneNumber);
                    log(`📞 ✅ Resolved via Method 3 (contact.${field}): ${lid} → ${phoneNumber}`);
                    break;
                  }
                }
              }
            }
          }
        }

        // Fallback: Use LID as phone number
        if (!resolved) {
          log(`⚠️ Could not resolve LID ${lid}, using as phone number`);
        }
      } else {
        log(`✅ Regular phone number: ${phoneNumber}`);
      }

      // Save incoming message to chat history with resolved phone number
      await saveChatHistoryWithPhone(sessionId, jid, msg, msgType, phoneNumber, lid);

      // Build webhook payload with resolved phone number
      const payload = await buildWebhookPayloadWithPhone(msg, msgType, sessionId, phoneNumber);
      log(`🔔 Dispatching webhook: event=${payload.event}, from=${jid}, phone=${phoneNumber}, type=${msgType}`);
      await dispatchWebhook(sessionId, payload);
    }
  });

  // ---- Handle message edits ----
  socket.ev.on('messages.update', async (updates) => {
    log(`📝 Messages update: ${updates?.length} updates`);

    for (const update of updates) {
      if (!update.update?.message) continue;

      const msgId = update.key?.id;
      const jid = update.key?.remoteJid;
      const isFromMe = update.key?.fromMe;

      log(`✏️ Message edited: id=${msgId}, from=${jid}, isFromMe=${isFromMe}`);

      // Update message in database
      try {
        const updatedMessage = update.update.message;
        const messageText = updatedMessage?.conversation ||
                           updatedMessage?.extendedTextMessage?.text ||
                           '[Edited media/caption]';

        // Find and update the message in database
        const existingMsg = await prisma.chatHistory.findFirst({
          where: {
            sessionId,
            message_id: msgId
          }
        });

        if (existingMsg) {
          await prisma.chatHistory.update({
            where: { id: existingMsg.id },
            data: {
              message: `${messageText} (edited)`,
              // Optionally add edited_at field if you add it to schema
            }
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

  // Also listen for m-receipt.update (message status)
  socket.ev.on('m-receipt.update', async (update) => {
    log('Receipt update:', update);
  });

  return { status: entry.status, qr: entry.qr };
}

function getMessageType(msg) {
  if (!msg.message) {
    log(`⚠️ Message has no message object: ${JSON.stringify(msg.key)}`);
    return 'text'; // Default to text for unknown
  }

  const keys = Object.keys(msg.message);

  // Text messages
  if (keys.includes('conversation')) return 'text';
  if (keys.includes('extendedTextMessage')) return 'text';

  // Image messages
  if (keys.includes('imageMessage')) return 'image';

  // Video messages
  if (keys.includes('videoMessage')) return 'video';

  // Document messages
  if (keys.includes('documentMessage')) return 'document';

  // Audio messages
  if (keys.includes('audioMessage')) return 'audio';

  // Sticker messages
  if (keys.includes('stickerMessage')) return 'sticker';

  // Contact messages
  if (keys.includes('contactMessage')) return 'contact';
  if (keys.includes('contactsArrayMessage')) return 'contact';

  // Location messages
  if (keys.includes('locationMessage')) return 'location';
  if (keys.includes('liveLocationMessage')) return 'location';

  // View once messages
  if (keys.includes('viewOnceMessage')) {
    const inner = msg.message.viewOnceMessage.message;
    if (inner) {
      const innerKeys = Object.keys(inner);
      if (innerKeys.includes('imageMessage')) return 'image_viewonce';
      if (innerKeys.includes('videoMessage')) return 'video_viewonce';
    }
    return 'viewonce';
  }

  // Reaction messages
  if (keys.includes('reactionMessage')) return 'reaction';

  // Poll messages
  if (keys.includes('pollCreationMessage')) return 'poll';
  if (keys.includes('pollUpdateMessage')) return 'poll';

  // Forwarded messages
  if (keys.includes('protocolMessage')) {
    const protocol = msg.message.protocolMessage;
    if (protocol.type === 0) return 'revoke'; // Message revoked
    return 'protocol';
  }

  // Log unknown type for debugging
  log(`⚠️ Unknown message type. Keys: ${keys.join(', ')}`);
  log(`   Full message structure: ${JSON.stringify(Object.keys(msg.message))}`);

  return 'text'; // Default fallback
}

async function buildWebhookPayload(msg, type, sessionId) {
  const jid = msg.key.remoteJid;
  // Extract actual phone number from JID (remove @s.whatsapp.net, @g.us, etc)
  const phoneNumber = normalizeJID(jid, sessionId);

  const base = {
    event: 'message.received',
    session_id: sessionId,
    from: jid,
    phone_number: phoneNumber, // Actual phone number (normalized)
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

/**
 * Save incoming message to chat history with pre-resolved phone number
 */
async function saveChatHistoryWithPhone(sessionId, jid, msg, msgType, phoneNumber, lid) {
  try {
    // Extract message text or caption based on type
    let messageText = '';

    if (msgType === 'text') {
      messageText = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || '';
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

    log(`💾 Saving chat: from=${phoneNumber}, lid=${lid}, type=${msgType}, message=${messageText.substring(0, 50)}`);

    // Save to chat history
    await prisma.chatHistory.create({
      data: {
        sessionId,
        messageId: msg.key?.id,
        from: phoneNumber,
        lid,
        message: messageText,
        type: msgType,
        isFromMe: false,
        timestamp: new Date(msg.messageTimestamp * 1000)
      }
    });

    // Cleanup old history
    await prisma.chatHistory.deleteMany({
      where: {
        sessionId,
        from: phoneNumber,
        createdAt: {
          lt: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))
        }
      }
    });

    // Update chat list
    const existingChat = await prisma.chat.findUnique({
      where: {
        sessionId_jid: {
          sessionId,
          jid: phoneNumber
        }
      }
    });

    if (existingChat) {
      await prisma.chat.update({
        where: { id: existingChat.id },
        data: {
          unreadCount: { increment: 1 },
          lastMessageTime: new Date(msg.messageTimestamp * 1000),
          lid: lid || existingChat.lid
        }
      });
    } else {
      await prisma.chat.create({
        data: {
          sessionId,
          jid: phoneNumber,
          lid,
          name: phoneNumber,
          unreadCount: 1,
          lastMessageTime: new Date(msg.messageTimestamp * 1000)
        }
      });
    }

    log(`💾 Chat history saved for ${phoneNumber} ${lid ? `(LID: ${lid})` : ''}`);
  } catch (err) {
    log(`❌ Error saving chat history: ${err.message}`);
    console.error(err.stack);
  }
}

/**
 * Build webhook payload with pre-resolved phone number
 */
async function buildWebhookPayloadWithPhone(msg, type, sessionId, phoneNumber) {
  const jid = msg.key.remoteJid;

  const base = {
    event: 'message.received',
    session_id: sessionId,
    from: jid,
    phone_number: phoneNumber, // Use resolved phone number
    message_id: msg.key.id,
    type,
    timestamp: msg.messageTimestamp
  };

  // Handle text messages
  if (type === 'text') {
    base.text = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || '';
  }

  // Handle image messages with caption
  if (type === 'image' || type === 'image_viewonce') {
    const imageMsg = msg.message?.imageMessage ||
                    msg.message?.viewOnceMessage?.message?.imageMessage;
    if (imageMsg) {
      base.mimetype = imageMsg.mimetype;
      base.filename = imageMsg.fileName || `image_${Date.now()}.jpg`;
      base.caption = imageMsg.caption || ''; // Include caption
      base.width = imageMsg.width;
      base.height = imageMsg.height;

      // Download and save media, include URL in webhook
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

  // Handle video messages with caption
  if (type === 'video' || type === 'video_viewonce') {
    const videoMsg = msg.message?.videoMessage ||
                    msg.message?.viewOnceMessage?.message?.videoMessage;
    if (videoMsg) {
      base.mimetype = videoMsg.mimetype;
      base.filename = videoMsg.fileName || `video_${Date.now()}.mp4`;
      base.caption = videoMsg.caption || ''; // Include caption
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

  // Handle document messages
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
      }
    }
  }

  return base;
}

/**
 * Get chat list for session
 */
export async function getChatList(sessionId) {
  try {
    console.log('[getChatList] Querying chats for session:', sessionId);

    const chats = await prisma.chat.findMany({
      where: { sessionId },
      orderBy: [{ lastMessageTime: 'desc' }]
    });

    console.log('[getChatList] Raw chats from DB:', chats.length);

    // Get last message for each chat
    const result = await Promise.all(chats.map(async (chat) => {
      // Get last message from chat history
      const lastMessage = await prisma.chatHistory.findFirst({
        where: {
          sessionId,
          from: chat.jid
        },
        orderBy: [{ timestamp: 'desc' }]
      });

      return {
        id: chat.jid,
        name: chat.name || chat.jid.split('@')[0],
        last_message: lastMessage ? {
          text: lastMessage.message,
          type: lastMessage.type,
          is_from_me: lastMessage.isFromMe,
          timestamp: lastMessage.timestamp.getTime()
        } : null,
        last_chat: lastMessage?.timestamp.getTime() || chat.lastMessageTime?.getTime() || 0,
        unread_count: chat.unreadCount
      };
    }));

    console.log('[getChatList] Returning:', result.length, 'chats');

    return result;
  } catch (err) {
    console.error('[getChatList] Error:', err.message);
    return [];
  }
}

/**
 * Get message history for a specific chat
 */
export async function getChatHistory(sessionId, jid, limit = 20) {
  try {
    const messages = await prisma.chatHistory.findMany({
      where: {
        sessionId,
        from: jid
      },
      orderBy: [{ timestamp: 'desc' }],
      take: limit
    });

    return messages.reverse().map(msg => ({
      id: msg.id,
      from: msg.from,
      message: msg.type === 'image' || msg.type === 'video' ? (msg.message || '[Media]') : msg.message,
      caption: msg.message, // For media messages, message field contains caption
      type: msg.type,
      is_from_me: msg.isFromMe,
      timestamp: msg.timestamp.getTime()
    }));
  } catch (err) {
    log(`❌ Error getting chat history: ${err.message}`);
    return [];
  }
}

/**
 * Get messages by phone number (across all sessions)
 */
export async function getMessagesByPhoneNumber(phoneNumber, sessionId = null, limit = 50) {
  try {
    // Normalize phone number - remove +, -, spaces
    const normalized = phoneNumber.replace(/[^0-9]/g, '');

    // Build search pattern for JID (phone number with @s.whatsapp.net)
    const jidPattern = `%${normalized}%`;

    const where = {
      from: { contains: normalized },
      ...(sessionId ? { sessionId } : {})
    };

    const messages = await prisma.chatHistory.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }],
      take: limit,
      include: {
        session: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return messages.reverse().map(msg => ({
      id: msg.id,
      session_id: msg.sessionId,
      session_name: msg.session?.name,
      from: msg.from,
      message: msg.message,
      type: msg.type,
      is_from_me: msg.isFromMe,
      timestamp: msg.timestamp.getTime()
    }));
  } catch (err) {
    log(`❌ Error getting messages by phone number: ${err.message}`);
    return [];
  }
}
