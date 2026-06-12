import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHtmlParts, parseEmail } from '../src/email-parser.js';

test('parseEmail extracts Sber download link and statement date', () => {
  const html = `
    <html>
      <body>
        <p>Период: 15.06.2026</p>
        <a href="https://example.test/download/statement.xlsx">Скачать выписку</a>
      </body>
    </html>
  `;

  assert.deepEqual(parseEmail(html), {
    link: 'https://example.test/download/statement.xlsx',
    fileName: 'Sber_Statement_2026-06-15.xlsx',
  });
});

test('parseEmail falls back to first non-mailto link when text is weak', () => {
  const html = `
    <html>
      <body>
        <a href="https://example.test/file.xlsx">Открыть файл</a>
        <a href="mailto:support@example.test">support</a>
      </body>
    </html>
  `;

  assert.equal(parseEmail(html).link, 'https://example.test/file.xlsx');
});

test('extractHtmlParts decodes a multipart MIME message', () => {
  const html = '<html><body><a href="https://example.test/sber.xlsx">Скачать выписку</a></body></html>';
  const htmlBase64 = Buffer.from(html).toString('base64');
  const source = Buffer.from([
    'Content-Type: multipart/alternative; boundary="BOUNDARY"',
    '',
    '--BOUNDARY',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Плоская версия письма',
    '--BOUNDARY',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '--BOUNDARY--',
  ].join('\r\n'));

  assert.deepEqual(extractHtmlParts(source), [html]);
});
