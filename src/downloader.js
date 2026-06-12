import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';
import { validateXlsxBuffer } from './xlsx-validator.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SBER_TLS_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

function isSberDownloadHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'sbi.sberbank.ru' && parsed.port === '9443';
  } catch {
    return false;
  }
}

function fetchOptions(url, timeoutMs) {
  const options = {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT },
  };

  if (isSberDownloadHost(url)) {
    options.dispatcher = SBER_TLS_DISPATCHER;
  }

  return options;
}

export async function headUrl(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    method: 'HEAD',
    ...fetchOptions(url, timeoutMs),
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

export async function downloadValidatedXlsx(url, filePath, options = {}) {
  const { timeoutMs = 30000 } = options;
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.tmp-${randomUUID()}.xlsx`);

  await fs.mkdir(directory, { recursive: true });

  try {
    const response = await fetch(url, {
      ...fetchOptions(url, timeoutMs),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        status: response.status,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const validation = validateXlsxBuffer(buffer);

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        status: response.status,
      };
    }

    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);

    return {
      success: true,
      size: buffer.length,
      entries: validation.entries,
    };
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return {
        success: false,
        error: `Timeout ${timeoutMs}ms`,
      };
    }

    return {
      success: false,
      error: error.message,
    };
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file may already be gone after successful rename.
    }
  }
}
