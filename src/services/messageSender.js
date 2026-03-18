import fs from 'fs/promises';
import { getSession } from './sessionManager.js';
import { prisma } from '../db/client.js';

const DELAY_MIN = parseInt(process.env.MEDIA_SEND_DELAY_MIN || '500');
const DELAY_MAX = parseInt(process.env.MEDIA_SEND_DELAY_MAX || '1000');

function randomDelay() {
  return new Promise(resolve =>
    setTimeout(resolve, DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN))
  );
}

function normalizeJid(to) {
  const clean = to.replace(/[^0-9]/g, '');
  return `${clean}@s.whatsapp.net`;
}

export async function sendText(sessionId, to, text, replyTo = null) {
  const entry = getSession(sessionId);
  if (!entry || entry.status !== 'connected') {
    throw new Error('Session not connected');
  }
  const jid = normalizeJid(to);
  const options = {};
  if (replyTo) options.quoted = { key: { id: replyTo, remoteJid: jid } };
  return await entry.socket.sendMessage(jid, { text }, options);
}

export async function sendMediaById(sessionId, to, mediaList, caption = null, replyTo = null) {
  const entry = getSession(sessionId);
  if (!entry || entry.status !== 'connected') {
    throw new Error('Session not connected');
  }
  const jid = normalizeJid(to);
  const results = [];

  for (let i = 0; i < mediaList.length; i++) {
    const media = mediaList[i];
    const fileBuffer = await fs.readFile(media.path);
    const mimeType = media.mimeType;
    const isLast = i === mediaList.length - 1;
    const options = {};
    if (replyTo && i === 0) options.quoted = { key: { id: replyTo, remoteJid: jid } };

    let message;
    if (mimeType.startsWith('image/')) {
      message = { image: fileBuffer, caption: isLast ? (caption || '') : '', mimetype: mimeType };
    } else if (mimeType.startsWith('video/')) {
      message = { video: fileBuffer, caption: isLast ? (caption || '') : '', mimetype: mimeType };
    } else if (mimeType.startsWith('audio/')) {
      message = { audio: fileBuffer, mimetype: mimeType, ptt: false };
    } else {
      message = { document: fileBuffer, fileName: media.filename, mimetype: mimeType, caption: isLast ? (caption || '') : '' };
    }

    const result = await entry.socket.sendMessage(jid, message, options);
    results.push(result);
    if (i < mediaList.length - 1) await randomDelay();
  }
  return results;
}
