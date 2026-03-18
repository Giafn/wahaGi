import fs from 'fs/promises';
import path from 'path';

const MEDIA_DIR = process.env.MEDIA_DIR || './media';
const INCOMING_DIR = path.join(MEDIA_DIR, 'incoming');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Cleanup old media files older than 1 hour
 * Run this every 15 minutes
 */
export async function cleanupOldMedia() {
  try {
    await fs.access(INCOMING_DIR);
  } catch {
    // Directory doesn't exist yet, nothing to clean
    return;
  }

  try {
    const files = await fs.readdir(INCOMING_DIR);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(INCOMING_DIR, file);
      
      try {
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > MAX_AGE_MS) {
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`[CLEANUP] Deleted old media: ${file} (age: ${Math.round(fileAge / 60000)} min)`);
        }
      } catch (err) {
        console.error(`[CLEANUP] Error processing ${file}:`, err.message);
      }
    }

    if (deletedCount > 0) {
      console.log(`[CLEANUP] Cleaned up ${deletedCount} old media file(s)`);
    }
  } catch (err) {
    console.error('[CLEANUP] Error:', err.message);
  }
}

/**
 * Start automatic cleanup every 15 minutes
 */
export function startMediaCleanup() {
  console.log('[CLEANUP] Starting media cleanup service (every 15 minutes, max age: 1 hour)');
  
  // Run cleanup every 15 minutes
  const interval = 15 * 60 * 1000;
  setInterval(cleanupOldMedia, interval);

  // Run initial cleanup after 1 minute
  setTimeout(cleanupOldMedia, 60 * 1000);
}
