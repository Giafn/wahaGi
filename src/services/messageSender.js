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
    // Ignore errors - non-critical
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

  const jid = toJID(to);

  // Auto read - mark chat as read in database
  await readAllMessages(sessionId, jid);

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

  // If already has @s.whatsapp.net or @g.us, return as is
  if (phoneNumber.includes('@')) {
    return phoneNumber;
  }

  // Check if this is a group ID (contains dash or already numeric with 15+ digits)
  if (phoneNumber.includes('-') || (phoneNumber.length >= 15 && /^\d+$/.test(phoneNumber))) {
    // Group ID - add @g.us
    return `${phoneNumber}@g.us`;
  }

  // Regular phone number - add @s.whatsapp.net
  const normalized = normalizeJID(phoneNumber);
  return `${normalized}@s.whatsapp.net`;
}

/**
 * Save outgoing message to chat history
 */
async function saveOutgoingMessage(sessionId, jid, message, type, messageId = null) {
  try {
    const normalizedJID = normalizeJID(jid);
    const lid = jid.split('@')[0];

    await prisma.chatHistory.create({
      data: {
        sessionId,
        messageId,
        from: normalizedJID,
        lid: lid !== normalizedJID ? lid : null,
        message,
        type,
        isFromMe: true,
        timestamp: new Date()
      }
    });

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
    }
  } catch (err) {
    console.error('[saveOutgoingMessage] Error:', err.message);
  }
}

/**
 * Normalize JID to phone number (or Group ID)
 */
function normalizeJID(jid) {
  if (!jid) return '';

  // Extract part before @
  let id = jid.split('@')[0];

  // Check if this looks like a Group ID (contains dash)
  if (id.includes('-')) {
    // Preserve Group ID format (keep dash)
    return id.replace(/^\+/, '');
  }

  // Regular phone number - remove non-digits
  id = id.replace(/^\+/, '').replace(/[^0-9]/g, '');
  return id;
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
