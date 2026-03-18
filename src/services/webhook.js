import fetch from 'node-fetch';
import { prisma } from '../db/client.js';

const RETRY_COUNT = parseInt(process.env.WEBHOOK_RETRY_COUNT || '3');
const RETRY_DELAY = parseInt(process.env.WEBHOOK_RETRY_DELAY || '2000');

export async function dispatchWebhook(sessionId, payload) {
  let session;
  try {
    session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { webhookUrl: true }
    });
  } catch {
    return;
  }

  if (!session?.webhookUrl) return;

  const body = JSON.stringify({ ...payload, session_id: sessionId });

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await fetch(session.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baileys-Event': payload.event || 'unknown',
          'X-Baileys-Session': sessionId
        },
        body,
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok) return; // Success

      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY * attempt);
      }
    } catch (err) {
      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY * attempt);
      }
    }
  }
  // After all retries, silently fail (logged above)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
