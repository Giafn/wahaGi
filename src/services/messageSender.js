import makeWASocket from '@whiskeysockets/baileys';
import { getSession } from './sessionManager.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs/promises';
import path from 'path';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';

/**
 * Send text message
 */
export async function sendText(sessionId, to, text, reply_to = null) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  const message = {
    text,
    ...(reply_to ? { quotedMessageId: reply_to } : {})
  };

  const result = await session.socket.sendMessage(jid, message);
  return result;
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
  const session = getSession(sessionId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session not connected');
  }

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  let message;
  const mediaType = getMediaType(mimetype);
  
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

  const result = await session.socket.sendMessage(jid, message);
  return result;
}

/**
 * Send multiple media files sequentially
 */
export async function sendMultipleMedia(sessionId, to, files, caption = null, reply_to = null) {
  const results = [];
  
  for (const file of files) {
    try {
      const result = await sendMedia(
        sessionId,
        to,
        file.buffer,
        file.mimetype,
        file.filename,
        caption,
        reply_to
      );
      results.push(result);
      
      // Delay between messages
      const delayMin = parseInt(process.env.MEDIA_SEND_DELAY_MIN || '500');
      const delayMax = parseInt(process.env.MEDIA_SEND_DELAY_MAX || '1000');
      const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
      await sleep(delay);
    } catch (err) {
      throw new Error(`Failed to send media ${file.filename}: ${err.message}`);
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
