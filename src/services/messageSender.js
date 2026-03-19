import makeWASocket from '@whiskeysockets/baileys';
import { getSession } from './sessionManager.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db/client.js';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';

/**
 * Read all unread messages for a specific chat
 */
async function readAllMessages(sessionId, jid) {
  try {
    const phoneNumber = jid.replace('@s.whatsapp.net', '');
    await prisma.chat.updateMany({
      where: { sessionId, jid: phoneNumber },
      data: { unreadCount: 0 }
    });
  } catch (err) {
    // Ignore
  }
}

/**
 * Send text message
 */
export async function sendText(sessionId, to, text, reply_to = null) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  // Convert phone number to proper JID format
  const jid = toJID(to);

  // Read all unread messages before sending (non-blocking)
  try {
    await readAllMessages(sessionId, jid);
  } catch (err) {
    console.log('[sendText] readAllMessages error (continuing):', err.message);
  }

  const message = {
    text,
    ...(reply_to ? { quotedMessageId: reply_to } : {})
  };

  const result = await session.socket.sendMessage(jid, message);

  // Save outgoing message to chat history
  if (result?.key?.id) {
    await saveOutgoingMessage(sessionId, jid, text, 'text', result.key.id);
  }

  return result;
}

/**
 * Convert phone number to proper JID format for sending
 */
function toJID(phoneNumber) {
  if (!phoneNumber) return '';
  // First normalize to just digits
  const normalized = normalizeJID(phoneNumber);
  // Then add @s.whatsapp.net
  return `${normalized}@s.whatsapp.net`;
}

/**
 * Save outgoing message to chat history
 */
async function saveOutgoingMessage(sessionId, jid, message, type, messageId = null) {
  try {
    // Normalize JID to phone number
    const normalizedJID = normalizeJID(jid);
    const lid = jid.split('@')[0]; // Store full JID as lid

    console.log('[saveOutgoingMessage] Saving:', {
      originalJID: jid,
      normalizedJID,
      lid,
      messageId,
      message,
      type
    });

    await prisma.chatHistory.create({
      data: {
        sessionId,
        messageId,
        from: normalizedJID,
        lid: lid !== normalizedJID ? lid : null, // Only store lid if different
        message,
        type,
        isFromMe: true,
        timestamp: new Date()
      }
    });

    console.log('[saveOutgoingMessage] Chat history saved');

    // Update chat list
    const existingChat = await prisma.chat.findUnique({
      where: {
        sessionId_jid: {
          sessionId,
          jid: normalizedJID
        }
      }
    });

    if (existingChat) {
      await prisma.chat.update({
        where: { id: existingChat.id },
        data: {
          lastMessageTime: new Date(),
          lid: lid !== normalizedJID ? lid : existingChat.lid
        }
      });
      console.log('[saveOutgoingMessage] Updated existing chat');
    } else {
      await prisma.chat.create({
        data: {
          sessionId,
          jid: normalizedJID,
          lid: lid !== normalizedJID ? lid : null,
          name: normalizedJID,
          unreadCount: 0,
          lastMessageTime: new Date()
        }
      });
      console.log('[saveOutgoingMessage] Created new chat');
    }
  } catch (err) {
    console.error('[saveOutgoingMessage] Error:', err.message);
    console.error('[saveOutgoingMessage] Stack:', err.stack);
  }
}

/**
 * Normalize JID to phone number
 */
function normalizeJID(jid) {
  if (!jid) return '';
  let phone = jid.split('@')[0];
  phone = phone.replace(/^\+/, '');
  phone = phone.replace(/[^0-9]/g, '');
  return phone;
}

/**
 * Send single media file
 */
export async function sendMedia(sessionId, to, buffer, mimetype, filename, caption = null, reply_to = null) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

  // Auto read - mark chat as read in database
  await readAllMessages(sessionId, jid);

  const mediaType = getMediaType(mimetype);
  let message;
  let processedBuffer = buffer;

  // Resize image if too large (for old CPU servers)
  if (mediaType === 'image' && buffer.length > 500000) {
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1280, height: 1280, fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (err) {
      processedBuffer = buffer;
    }
  }

  if (mediaType === 'image') {
    message = { image: processedBuffer, mimetype, ...(caption ? { caption } : {}) };
  } else if (mediaType === 'video') {
    message = { video: processedBuffer, mimetype, ...(caption ? { caption } : {}) };
  } else if (mediaType === 'audio') {
    message = { audio: processedBuffer, mimetype, ptt: mimetype.includes('ogg') };
  } else {
    message = { document: processedBuffer, mimetype, fileName: filename, ...(caption ? { caption } : {}) };
  }

  // Retry logic for sendMessage
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await session.socket.sendMessage(jid, message);
      if (result?.key?.id) {
        await saveOutgoingMessage(sessionId, jid, caption || `[${mediaType}]`, mediaType);
      }
      return result;
    } catch (err) {
      lastError = err;
      console.error(`sendMessage attempt ${attempt} failed:`, err.message);
      if (attempt < 3) {
        await sleep(1000 * attempt); // Wait 1s, 2s before retry
      }
    }
  }

  throw lastError;
}

/**
 * Send multiple media files sequentially
 */
export async function sendMultipleMedia(sessionId, to, files, caption = null, reply_to = null) {
  const results = [];
  const lastIndex = files.length - 1;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const fileCaption = (i === lastIndex) ? caption : null;
      const result = await sendMedia(sessionId, to, file.buffer, file.mimetype, file.filename, fileCaption, reply_to);
      if (result) results.push(result);

      if (i < lastIndex) {
        const delay = Math.floor(Math.random() * 500) + 500;
        await sleep(delay);
      }
    } catch (err) {
      console.error('Failed to send file:', err.message);
    }
  }

  return results;
}

/**
 * Get media type from mimetype
 */
function getMediaType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download media from message and save to file
 * Returns the file URL
 */
export async function downloadAndSaveMedia(msg, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  try {
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
    const filePath = path.join(MEDIA_DIR, filename);
    
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(filePath, buffer);
    
    const fileUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/media/files/${filename}`;
    
    return {
      filename,
      filePath,
      fileUrl,
      mimetype,
      size: buffer.length
    };
  } catch (err) {
    console.error('Error downloading media:', err.message);
    throw err;
  }
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
