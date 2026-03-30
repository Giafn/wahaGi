import makeWASocket from '@whiskeysockets/baileys';
import { getSession, normalizeJID } from './sessionManager.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db/client.js';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';

// Helper logging - only when DEBUG=true
const log = (msg, ...args) => {
  if (process.env.DEBUG === 'true') {
    console.log(`[Presence] ${msg}`, ...args);
  }
};

/**
 * Send text message using LID
 * Note: We don't toggle presence here - let WhatsApp handle it naturally
 * markOnlineOnConnect is disabled in sessionManager.js
 */
export async function sendText(sessionId, lid, text, reply_to = null) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  const jid = toJID(lid);

  const message = {
    text,
    ...(reply_to ? { quotedMessageId: reply_to } : {})
  };

  const result = await session.socket.sendMessage(jid, message);

  if (result?.key?.id) {
    await saveOutgoingMessage(sessionId, jid, text, 'text', result.key.id, lid);
  }

  return result;
}

/**
 * Convert LID to proper JID format for sending
 */
function toJID(lid) {
  if (!lid) return '';

  if (lid.includes('@')) {
    return lid;
  }

  if (lid.includes('-') || (lid.length >= 15 && /^\d+$/.test(lid))) {
    return `${lid}@g.us`;
  }

  const normalized = lid.replace(/[^0-9]/g, '');
  return `${normalized}@s.whatsapp.net`;
}

/**
 * Save outgoing message to chat history with LID
 */
async function saveOutgoingMessage(sessionId, jid, message, type, messageId = null, lid = null) {
  try {
    if (!lid) {
      lid = jid.split('@')[0];
    }

    await prisma.chatHistory.create({
      data: {
        sessionId,
        messageId,
        from: lid,
        message,
        type,
        isFromMe: true,
        timestamp: new Date()
      }
    });

    const existingChat = await prisma.chat.findUnique({
      where: {
        sessionId_lid: {
          sessionId,
          lid
        }
      }
    });

    if (existingChat) {
      await prisma.chat.update({
        where: { id: existingChat.id },
        data: {
          lastMessageTime: new Date()
        }
      });
    } else {
      await prisma.chat.create({
        data: {
          sessionId,
          lid,
          name: lid,
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
