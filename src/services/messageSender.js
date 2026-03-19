import makeWASocket from '@whiskeysockets/baileys';
import { getSession } from './sessionManager.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db/client.js';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';

/**
 * Read all unread messages for a specific chat
 * Note: Only updates database, does NOT send read receipt to WhatsApp to avoid crashes
 */
async function readAllMessages(sessionId, jid) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    console.log('[readAllMessages] Session not connected, skipping read');
    return;
  }

  // Check if socket is available
  if (!session.socket) {
    console.log('[readAllMessages] Socket not available, skipping read');
    return;
  }

  try {
    // Normalize JID to phone number
    const phoneNumber = jid.replace('@s.whatsapp.net', '');

    // Get unread messages from database (only those with messageId)
    const unreadMessages = await prisma.chatHistory.findMany({
      where: {
        sessionId,
        from: phoneNumber,
        isFromMe: false,
        messageId: {
          not: null
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    if (unreadMessages.length === 0) {
      console.log('[readAllMessages] No unread messages to read');
      return;
    }

    console.log(`[readAllMessages] Found ${unreadMessages.length} unread messages for ${phoneNumber}`);

    // Update unread count in database only (don't send read receipt to WhatsApp)
    try {
      await prisma.chat.updateMany({
        where: {
          sessionId,
          jid: phoneNumber
        },
        data: {
          unreadCount: 0
        }
      });
      console.log('[readAllMessages] ✅ Updated database unread count (read receipt to WhatsApp disabled)');
    } catch (dbErr) {
      console.error('[readAllMessages] DB update failed:', dbErr.message);
    }
  } catch (err) {
    // Non-blocking: don't crash the app, just log error
    console.error('[readAllMessages] Non-critical error (continuing):', err.message);
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
 * @param {string} sessionId - Session ID
 * @param {string} to - Phone number
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - MIME type
 * @param {string} filename - Original filename
 * @param {string} caption - Optional caption
 * @param {string} reply_to - Optional reply message ID
 */
export async function sendMedia(sessionId, to, buffer, mimetype, filename, caption = null, reply_to = null) {
  console.log('[sendMedia] Starting...');

  const session = getSession(sessionId);
  console.log('[sendMedia] Session:', session ? 'found' : 'not found', 'Status:', session?.status);

  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  console.log('[sendMedia] JID:', jid);

  // Read all unread messages before sending (non-blocking)
  try {
    console.log('[sendMedia] Calling readAllMessages...');
    await readAllMessages(sessionId, jid);
    console.log('[sendMedia] readAllMessages completed');
  } catch (err) {
    console.log('[sendMedia] readAllMessages error (continuing):', err.message);
  }

  console.log('[sendMedia] Determining media type...');
  let message;
  const mediaType = getMediaType(mimetype);
  console.log('[sendMedia] Media type:', mediaType);

  if (mediaType === 'image') {
    message = {
      image: buffer,
      mimetype,
      fileName: filename,
      ...(caption ? { caption } : {})
    };
  } else if (mediaType === 'video') {
    message = {
      video: buffer,
      mimetype,
      fileName: filename,
      ...(caption ? { caption } : {})
    };
  } else if (mediaType === 'audio') {
    message = {
      audio: buffer,
      mimetype,
      ptt: mimetype.includes('ogg')
    };
  } else if (mediaType === 'document') {
    message = {
      document: buffer,
      mimetype,
      fileName: filename,
      ...(caption ? { caption } : {})
    };
  } else {
    // Default to document
    message = {
      document: buffer,
      mimetype,
      fileName: filename
    };
  }

  console.log('[sendMedia] About to call sendMessage...');
  console.log('[sendMedia] Socket exists:', !!session.socket);
  console.log('[sendMedia] Socket sendMessage exists:', typeof session.socket?.sendMessage);

  try {
    console.log('[sendMedia] Calling session.socket.sendMessage...');
    const result = await session.socket.sendMessage(jid, message);
    console.log('[sendMedia] sendMessage completed, result:', result?.key?.id);

    // Save outgoing message to chat history
    if (result?.key?.id) {
      console.log('[sendMedia] Saving outgoing message...');
      await saveOutgoingMessage(sessionId, jid, caption || `[${mediaType}]`, mediaType);
      console.log('[sendMedia] Message saved');
    }

    console.log('[sendMedia] Returning result');
    return result;
  } catch (err) {
    console.error('[sendMedia] CRITICAL ERROR:', err.message);
    console.error('[sendMedia] Error type:', err.constructor.name);
    console.error('[sendMedia] Full error:', err);
    console.error('[sendMedia] Stack:', err.stack);
    console.error('[sendMedia] Socket state:', session.socket?.chats?.length);
    throw err;
  }
}

/**
 * Send multiple media files sequentially
 * Caption is only applied to the last media file
 */
export async function sendMultipleMedia(sessionId, to, files, caption = null, reply_to = null) {
  const results = [];
  const lastIndex = files.length - 1;

  console.log('[SEND-MULTIPLE] Starting to send', files.length, 'media files');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      console.log('[SEND-MULTIPLE] Sending file', i + 1, 'of', files.length, ':', file.filename);

      // Only add caption to the last media file
      const fileCaption = (i === lastIndex) ? caption : null;

      const result = await sendMedia(
        sessionId,
        to,
        file.buffer,
        file.mimetype,
        file.filename,
        fileCaption,
        reply_to
      );
      results.push(result);
      console.log('[SEND-MULTIPLE] File', i + 1, 'sent successfully');

      // Delay between messages (except after the last one)
      if (i < lastIndex) {
        const delayMin = parseInt(process.env.MEDIA_SEND_DELAY_MIN || '500');
        const delayMax = parseInt(process.env.MEDIA_SEND_DELAY_MAX || '1000');
        const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
        await sleep(delay);
      }
    } catch (err) {
      console.error('[SEND-MULTIPLE] Failed to send file', i + 1, ':', err.message);
      // Continue with next file instead of throwing
      // throw new Error(`Failed to send media ${file.filename}: ${err.message}`);
    }
  }

  console.log('[SEND-MULTIPLE] Completed sending', results.length, 'of', files.length, 'files');
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
