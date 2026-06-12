import * as cheerio from 'cheerio';

function decodeQuotedPrintable(value) {
  return value.replace(/=([0-9A-Fa-f]{2})|=\r?\n/g, (_, hex) => {
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return '';
  });
}

function decodeBase64(value) {
  return Buffer.from(value.replace(/\s/g, ''), 'base64').toString('utf8');
}

function unfoldHeaders(rawHeaders) {
  const lines = rawHeaders.replace(/\r\n/g, '\n').split('\n');
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

function splitMimeParts(rawSource) {
  const source = Buffer.isBuffer(rawSource) ? rawSource : Buffer.from(rawSource);
  const headerEnd = source.indexOf(Buffer.from('\r\n\r\n'));
  const separator = headerEnd === -1 ? Buffer.from('\n\n') : Buffer.from('\r\n\r\n');
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
  const chunks = splitBuffer(body, Buffer.from(`--${boundary}`));

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

export function extractHtmlParts(rawSource) {
  const parts = splitMimeParts(rawSource);
  const htmlParts = parts
    .filter((part) => String(part.headers['content-type'] || '').toLowerCase().includes('text/html'))
    .map((part) => decodePart(part))
    .filter(Boolean);

  if (htmlParts.length > 0) return htmlParts;

  const source = Buffer.isBuffer(rawSource) ? rawSource.toString('utf8') : String(rawSource);
  const htmlMatch = source.match(/<html[\s\S]*?<\/html>/i);
  return htmlMatch ? [htmlMatch[0]] : [];
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

export function parseEmail(htmlSource) {
  const html = Array.isArray(htmlSource) ? htmlSource.join('\n') : String(htmlSource || '');
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
