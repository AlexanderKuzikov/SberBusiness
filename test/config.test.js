import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { nextRunDelayMs, parseTime } from '../src/scheduler.js';

const envKeys = [
  'IMAP_HOST',
  'IMAP_PORT',
  'IMAP_SECURE',
  'IMAP_USER',
  'IMAP_PASS',
  'IMAP_MAILBOX',
  'SEARCH_SUBJECT',
  'DOWNLOAD_DIR',
  'SUCCESS_TIME',
  'RETRY_HOURS',
  'LOG_DIR',
  'LOG_FILE',
  'STATUS_FILE',
  'HEAD_TIMEOUT_MS',
  'DOWNLOAD_TIMEOUT_MS',
  'TRAY_ENABLED',
];

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('scheduler parses and calculates next run time', () => {
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 });
  assert.throws(() => parseTime('24:00'));

  const now = new Date(2026, 0, 1, 10, 0, 0);
  assert.equal(nextRunDelayMs('23:59', now), 13 * 60 * 60 * 1000 + 59 * 60 * 1000);
  assert.equal(nextRunDelayMs('09:59', now), 23 * 60 * 60 * 1000 + 59 * 60 * 1000);
});

test('loadConfig validates config and applies env overrides', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sber-config-'));
  const configPath = path.join(tempDir, 'config.json');
  const previous = snapshotEnv(envKeys);

  await fs.writeFile(configPath, JSON.stringify({
    imap: {
      host: 'imap.placeholder.test',
      port: 993,
      secure: true,
      auth: {
        userEnv: 'IMAP_USER',
        passEnv: 'IMAP_PASS',
      },
    },
    mailbox: 'INBOX',
    search: { subject: 'Выписка по счету' },
    downloadDir: 'C:\\SberStatements',
    successTime: '10:00',
    retryHours: 3,
    logs: {
      dir: 'logs',
      file: 'sber.log',
      statusFile: 'status.json',
    },
    download: {
      headTimeoutMs: 10000,
      timeoutMs: 30000,
    },
    tray: {
      enabled: true,
      title: 'SberBusiness',
      tooltip: 'Ожидание проверки...',
    },
  }, null, 2));

  process.env.IMAP_HOST = 'imap.test';
  process.env.IMAP_PORT = '993';
  process.env.IMAP_USER = 'user@example.test';
  process.env.IMAP_PASS = 'secret';
  process.env.IMAP_MAILBOX = 'INBOX.Sber';
  process.env.SEARCH_SUBJECT = 'Statement';
  process.env.DOWNLOAD_DIR = 'D:\\Statements';
  process.env.SUCCESS_TIME = '11:30';
  process.env.RETRY_HOURS = '4';
  process.env.TRAY_ENABLED = 'false';

  try {
    const { config } = await loadConfig(configPath);

    assert.equal(config.imap.host, 'imap.test');
    assert.equal(config.imap.auth.user, 'user@example.test');
    assert.equal(config.imap.auth.pass, 'secret');
    assert.equal(config.mailbox, 'INBOX.Sber');
    assert.equal(config.search.subject, 'Statement');
    assert.equal(config.downloadDir, 'D:\\Statements');
    assert.equal(config.successTime, '11:30');
    assert.equal(config.retryHours, 4);
    assert.equal(config.tray.enabled, false);
  } finally {
    restoreEnv(previous);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
