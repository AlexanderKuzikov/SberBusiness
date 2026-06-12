import * as cheerio from 'cheerio';

const SBER_DOWNLOAD_URL_PATTERN = /https:\/\/sbi\.sberbank\.ru:9443\/ic\/ufs\/scheduled-statements\/v1\/rest\/download\/mail\/reports\/[A-Za-z0-9]+/g;

function decodeQuotedPrintable(value) {
  return String(value || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64(value) {
  try {
    return Buffer.from(String(value || '').replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return String(value || '');
  }
}

function unfoldHeaders(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const unfolded = [];

  for (const line of lines) {
    if (/^\s/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function parseHeaders(raw) {
  const [rawHeaderBlock = '', rawBody = ''] = raw.split(/\n\r?\n|\r\n\r\n/, 2);
  const headers = {};

  for (const line of unfoldHeaders(rawHeaderBlock)) {
    if (!line.trim() || !line.includes(':')) continue;
    const index = line.indexOf(':');
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[name] = value;
  }

  return { headers, body: rawBody };
}

function getBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : null;
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;

  for (;;) {
    const index = buffer.indexOf(separator, start);
    if (index === -1) {
      parts.push(buffer.subarray(start));
      return parts;
    }
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
  }
}

function stripBoundaryPrefix(source) {
  let result = source;

  while (result.startsWith('\r\n') || result.startsWith('\n')) {
    result = result.replace(/^\r?\n/, '');
  }

  if (result.startsWith('--')) {
    result = result.replace(/^--.*(?:\r?\n|\n)/, '');
  }

  while (result.startsWith('\r\n') || result.startsWith('\n')) {
    result = result.replace(/^\r?\n/, '');
  }

  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitMimeBoundary(buffer, boundary) {
  const regex = new RegExp(`--${escapeRegExp(boundary)}`, 'i');
  return String(buffer.toString('utf8'))
    .split(regex)
    .map((chunk) => Buffer.from(chunk));
}

function splitMimeParts(rawSource) {
  let source = Buffer.isBuffer(rawSource) ? rawSource : Buffer.from(rawSource);
  source = Buffer.from(stripBoundaryPrefix(source.toString('utf8')));
  const separator = source.includes(Buffer.from('\r\n\r\n')) ? Buffer.from('\r\n\r\n') : Buffer.from('\n\n');
  const headerEndIndex = source.indexOf(separator);

  if (headerEndIndex === -1) {
    return [{ headers: {}, body: source.toString('utf8') }];
  }

  const headers = parseHeaders(source.subarray(0, headerEndIndex).toString('utf8'));
  const boundary = getBoundary(headers.headers['content-type']);

  if (!boundary) {
    return [{ headers, body: source.subarray(headerEndIndex + separator.length).toString('utf8') }];
  }

  const body = source.subarray(headerEndIndex + separator.length);
  const chunks = splitMimeBoundary(body, boundary);

  return chunks
    .map((chunk) => {
      if (chunk.length >= 2 && chunk[0] === 0x0d && chunk[1] === 0x0a) return chunk.subarray(2);
      if (chunk.length >= 1 && chunk[0] === 0x0a) return chunk.subarray(1);
      return chunk;
    })
    .filter((chunk) => {
      const text = chunk.toString('utf8').trim();
      return text.length > 0 && !text.startsWith('--');
    })
    .map((chunk) => parseHeaders(chunk.toString('utf8')));
}

function decodePart(part) {
  const encoding = String(part.headers['content-transfer-encoding'] || '').toLowerCase();

  if (encoding.includes('base64')) return decodeBase64(part.body);
  if (encoding.includes('quoted-printable')) return decodeQuotedPrintable(part.body);

  return part.body;
}

function collectTextParts(rawSource) {
  const parts = splitMimeParts(rawSource);
  const collected = [];

  for (const part of parts) {
    const contentType = String(part.headers['content-type'] || '').toLowerCase();

    if (contentType.startsWith('multipart/')) {
      collected.push(...collectTextParts(part.body));
      continue;
    }

    if (contentType.includes('text/html') || contentType.includes('text/plain')) {
      collected.push({
        type: contentType.includes('text/html') ? 'html' : 'text',
        content: decodePart(part),
      });
    }
  }

  return collected;
}

function isValidDate(dateStr) {
  const [day, month, year] = dateStr.split('.').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function todayFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `Sber_Statement_${yyyy}-${mm}-${dd}.xlsx`;
}

function statementFileName(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.');
  return `Sber_Statement_${yyyy}-${mm}-${dd}.xlsx`;
}

function extractSberDownloadLink(source) {
  const normalized = decodeQuotedPrintable(String(source || ''));
  return normalized.match(SBER_DOWNLOAD_URL_PATTERN)?.[0] || null;
}

function extractStatementDate(source) {
  const text = String(source || '').replace(/\s+/g, ' ').trim();
  const periodMatch = text.match(/период\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i)
    || text.match(/(\d{2}\.\d{2}\.\d{4})/);

  return periodMatch && isValidDate(periodMatch[1]) ? periodMatch[1] : null;
}

export function extractHtmlParts(rawSource) {
  const parts = collectTextParts(rawSource);
  const htmlParts = parts
    .filter((part) => part.type === 'html')
    .map((part) => part.content)
    .filter(Boolean);

  if (htmlParts.length > 0) return htmlParts;

  const textParts = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .filter(Boolean);

  if (textParts.length > 0) return textParts;

  return [String(rawSource || '')];
}

export function parseEmail(emailSource) {
  const sources = Array.isArray(emailSource) ? emailSource : [String(emailSource || '')];
  const source = sources.join('\n');
  const directLink = extractSberDownloadLink(source);

  if (directLink) {
    const dateStr = extractStatementDate(source);
    return {
      link: directLink,
      fileName: dateStr ? statementFileName(dateStr) : todayFileName(),
    };
  }

  const html = sources.join('\n');
  const $ = cheerio.load(html);
  let link = null;

  $('a[href]').each((_, element) => {
    if (link) return;
    const href = $(element).attr('href') || '';
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (/скачать\s+выписк/i.test(text)) {
      link = href;
    }
  });

  if (!link) {
    $('a[href]').each((_, element) => {
      if (link) return;
      const href = $(element).attr('href') || '';
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (/выписк|statement|download|sber/i.test(`${text} ${href}`) && !href.startsWith('mailto:')) {
        link = href;
      }
    });
  }

  if (!link) {
    const firstHref = $('a[href]').first().attr('href');
    link = firstHref && !firstHref.startsWith('mailto:') ? firstHref : null;
  }

  const fullText = $.text().replace(/\s+/g, ' ').trim();
  const periodMatch = fullText.match(/период\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i)
    || fullText.match(/(\d{2}\.\d{2}\.\d{4})/);
  const dateStr = periodMatch && isValidDate(periodMatch[1]) ? periodMatch[1] : null;

  return {
    link,
    fileName: dateStr ? statementFileName(dateStr) : todayFileName(),
  };
}
