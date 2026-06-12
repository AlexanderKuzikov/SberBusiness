import { ImapFlow } from 'imapflow';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  cliHelp,
  loadConfig,
  parseCliArgs,
  redactConfig,
  resolveRuntimePaths,
} from './src/config.js';
import { downloadValidatedXlsx, headUrl } from './src/downloader.js';
import { extractHtmlParts, parseEmail } from './src/email-parser.js';
import { createDailyTimer, createDelayTimer } from './src/scheduler.js';
import { initTray, showNotification } from './src/tray.js';

let trayApi = null;
let dailyTimer = null;
let retryTimer = null;
let running = false;
let shuttingDown = false;

const status = {
  lastCheck: null,
  lastSuccess: null,
  lastError: null,
  filesCount: 0,
};

function safeMessage(error) {
  return error && error.message ? error.message : String(error);
}

async function log(config, level, message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}\n`;
  console.log(entry.trim());

  try {
    await fs.mkdir(path.dirname(config.logFile), { recursive: true });
    await fs.appendFile(config.logFile, entry);
  } catch (error) {
    console.error(`Ошибка записи лога: ${safeMessage(error)}`);
  }
}

async function saveStatus(config) {
  try {
    await fs.mkdir(path.dirname(config.statusFile), { recursive: true });
    await fs.writeFile(config.statusFile, JSON.stringify(status, null, 2));
  } catch (error) {
    await log(config, 'WARN', `Не удалось сохранить статус: ${safeMessage(error)}`);
  }
}

async function countDownloadedFiles(config) {
  try {
    const files = await fs.readdir(config.downloadDir);
    return files.filter((file) => file.toLowerCase().endsWith('.xlsx')).length;
  } catch {
    return 0;
  }
}

async function updateTrayText(text, iconStatus = 'waiting') {
  if (!trayApi) return;
  await trayApi.update(text, iconStatus);
}

async function markSeen(client, uid) {
  await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
}

async function processMessage(client, uid, config) {
  const download = client.fetch(uid, { source: true });
  let emailSource = '';

  for await (const chunk of download) {
    emailSource += chunk.source.toString();
  }

  const htmlParts = extractHtmlParts(emailSource);
  if (htmlParts.length === 0) {
    await log(config, 'WARN', `UID ${uid}: HTML-часть не найдена`);
    await markSeen(client, uid);
    return { seen: true, reason: 'html-missing' };
  }

  const { link, fileName } = parseEmail(htmlParts);

  if (!link) {
    await log(config, 'WARN', `UID ${uid}: ссылка не найдена`);
    await markSeen(client, uid);
    return { seen: true, reason: 'link-missing' };
  }

  const filePath = path.join(config.downloadDir, fileName);

  if (fsSync.existsSync(filePath)) {
    const stat = fsSync.statSync(filePath);
    if (stat.size > 0) {
      await log(config, 'INFO', `${fileName}: уже существует`);
      await markSeen(client, uid);
      return { seen: true, reason: 'exists' };
    }
  }

  try {
    const head = await headUrl(link, config.download.headTimeoutMs);
    if ([403, 404, 410].includes(head.status)) {
      await log(config, 'ERROR', `${fileName}: ссылка истекла (HTTP ${head.status})`);
      await markSeen(client, uid);
      return { seen: true, reason: 'expired', expired: true };
    }
  } catch (error) {
    await log(config, 'WARN', `HEAD-запрос упал: ${safeMessage(error)}`);
  }

  await log(config, 'INFO', `Скачивание: ${fileName}`);
  const result = await downloadValidatedXlsx(link, filePath, {
    timeoutMs: config.download.timeoutMs,
  });

  if (result.success) {
    await log(config, 'INFO', `${fileName}: сохранено (${result.size} байт)`);
    await markSeen(client, uid);
    return { seen: true, success: true };
  }

  await log(config, 'ERROR', `${fileName}: ${result.error}`);

  if ([403, 404, 410].includes(result.status)) {
    await markSeen(client, uid);
    return { seen: true, expired: true, reason: 'expired' };
  }

  return { seen: true, error: result.error };
}

export async function checkAndDownload(config) {
  if (running) {
    await log(config, 'WARN', 'Проверка уже выполняется, новый запуск пропущен');
    return {
      skipped: true,
      success: true,
      hadNetworkError: false,
      expiredLinkCount: 0,
      successCount: 0,
    };
  }

  running = true;
  await updateTrayText('Проверка почты...', 'waiting');
  await log(config, 'INFO', '=== Запуск проверки ===');

  let client;
  let lock;
  let hadNetworkError = false;
  let expiredLinkCount = 0;
  let successCount = 0;
  let errorSummary = null;

  try {
    await fs.mkdir(config.downloadDir, { recursive: true });

    client = new ImapFlow({
      ...config.imap,
      logger: false,
    });

    await client.connect();
    await log(config, 'INFO', 'Подключено к IMAP');

    lock = await client.getMailboxLock(config.mailbox);

    try {
      const searchCriteria = {
        unseen: true,
        subject: config.search.subject,
      };

      if (config.search.from) {
        searchCriteria.from = config.search.from;
      }

      const searchResult = await client.search(searchCriteria, { uid: true }) || [];

      if (searchResult.length === 0) {
        await log(config, 'INFO', 'Нет новых писем с выпиской');
        return {
          success: true,
          hadNetworkError: false,
          expiredLinkCount: 0,
          successCount: 0,
          errorSummary: null,
        };
      }

      await log(config, 'INFO', `Найдено писем: ${searchResult.length}`);

      for (const uid of searchResult) {
        const result = await processMessage(client, uid, config);

        if (result.expired) expiredLinkCount += 1;
        if (result.success) successCount += 1;
        if (result.error && !hadNetworkError) {
          hadNetworkError = true;
          errorSummary = result.error;
          break;
        }
      }
    } finally {
      if (lock) lock.release();
    }
  } catch (error) {
    hadNetworkError = true;
    errorSummary = safeMessage(error);
    await log(config, 'ERROR', `Критическая ошибка: ${errorSummary}`);
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch (error) {
        await log(config, 'WARN', `IMAP logout failed: ${safeMessage(error)}`);
      }
    }

    running = false;
  }

  return {
    success: successCount > 0 && !hadNetworkError && expiredLinkCount === 0,
    hadNetworkError,
    expiredLinkCount,
    successCount,
    errorSummary,
  };
}

async function finishRun(config, result) {
  status.lastCheck = new Date().toISOString();

  if (result.successCount > 0) {
    status.lastSuccess = new Date().toISOString();
  }

  if (result.hadNetworkError || result.expiredLinkCount > 0) {
    status.lastError = {
      time: new Date().toISOString(),
      message: result.hadNetworkError
        ? (result.errorSummary || 'Сетевая ошибка')
        : `Протухших ссылок: ${result.expiredLinkCount}`,
    };
  } else {
    status.lastError = null;
  }

  status.filesCount = await countDownloadedFiles(config);
  await saveStatus(config);

  if (result.expiredLinkCount > 0) {
    const text = `⚠️ Протухших ссылок: ${result.expiredLinkCount}. Кликните для деталей.`;
    showNotification(
      'SberBusiness — проблема',
      `Не удалось скачать ${result.expiredLinkCount} выписок: ссылки истекли.\n\nПроверьте: ${config.logFile}`,
      'Warning',
    );
    await updateTrayText(text, 'error');
    scheduleRetry(config);
    return;
  }

  if (result.hadNetworkError) {
    const text = `❌ Сетевая ошибка. Повтор через ${config.retryHours} ч.`;
    showNotification(
      'SberBusiness — ошибка сети',
      `Не удалось подключиться. Следующая попытка через ${config.retryHours} часа.\n\nПроверьте: ${config.logFile}`,
      'Error',
    );
    await updateTrayText(text, 'error');
    scheduleRetry(config);
    return;
  }

  const msg = `✅ Последняя проверка: ${new Date().toLocaleString('ru-RU')}. Файлов: ${status.filesCount}.`;
  await updateTrayText(msg, 'success');
}

function scheduleRetry(config) {
  if (retryTimer) retryTimer.stop();

  retryTimer = createDelayTimer(config.retryHours, async () => {
    retryTimer = null;
    await log(config, 'INFO', 'Автоматический повтор после ошибки');
    const result = await checkAndDownload(config);
    await finishRun(config, result);
  });
}

function scheduleDaily(config) {
  if (dailyTimer) dailyTimer.stop();

  dailyTimer = createDailyTimer(config.successTime, async () => {
    await log(config, 'INFO', 'Сработал ежедневный триггер');
    const result = await checkAndDownload(config);
    await finishRun(config, result);
  });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (configForShutdown) {
    await log(configForShutdown, 'INFO', 'Получен сигнал завершения');
  }
  if (dailyTimer) dailyTimer.stop();
  if (retryTimer) retryTimer.stop();
  if (trayApi) await trayApi.close();
}

let configForShutdown = null;

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    console.log(cliHelp());
    return;
  }

  const { config: baseConfig, configPath } = await loadConfig(args.config);
  const config = resolveRuntimePaths({
    ...baseConfig,
    once: args.once,
    dryRun: args.dryRun,
    configPath,
  });
  configForShutdown = config;

  if (args.dryRun) {
    console.log(JSON.stringify(redactConfig(config), null, 2));
    return;
  }

  await log(config, 'INFO', '========================================');
  await log(config, 'INFO', 'SberBusiness запущен');
  await log(config, 'INFO', `Config: ${config.configPath}`);
  await log(config, 'INFO', `Почта: ${config.imap.auth.user}`);
  await log(config, 'INFO', `Папка: ${config.downloadDir}`);
  await log(config, 'INFO', `Время проверки: ежедневно в ${config.successTime}`);
  await log(config, 'INFO', '========================================');

  if (config.tray.enabled) {
    trayApi = await initTray({
      config,
      log: (level, message) => log(config, level, message),
      onCheckNow: async () => {
        const result = await checkAndDownload(config);
        await finishRun(config, result);
      },
      onExit: async () => {
        await shutdown();
        process.exit(0);
      },
    });
    await updateTrayText('SberBusiness запущен. Ожидание...', 'waiting');
  }

  const initialResult = await checkAndDownload(config);
  await finishRun(config, initialResult);

  if (!args.once) {
    scheduleDaily(config);
    await log(config, 'INFO', `Ежедневный триггер установлен на ${config.successTime}`);
  }
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});

main().catch(async (error) => {
  console.error('Unhandled error:', error);
  if (configForShutdown) {
    await log(configForShutdown, 'ERROR', `Unhandled error: ${safeMessage(error)}`);
  }
  if (trayApi) await trayApi.close();
  process.exit(1);
});
