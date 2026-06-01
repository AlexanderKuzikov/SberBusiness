import { ImapFlow } from 'imapflow';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import SysTray from 'systray2';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === КОНФИГУРАЦИЯ ===
const CONFIG = {
  imap: {
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993'),
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    },
    secure: true,
    logger: false,
  },
  downloadDir: process.env.DOWNLOAD_DIR || 'C:\\SberStatements',
  scriptDir: process.env.SCRIPT_DIR || __dirname,
  successTime: process.env.SUCCESS_TIME || '10:00',
  retryHours: parseInt(process.env.RETRY_HOURS || '3'),
  logFile: path.join(__dirname, 'logs', 'sber.log'),
  statusFile: path.join(__dirname, 'logs', 'status.json'),
};

// === ИКОНКИ В BASE64 (PNG 32x32) ===
const ICONS = {
  // Серая иконка (ожидание)
  waiting: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABjSURBVFiF7dYxCgAgDEPR3P/W1kHBCxRG0FZx8K8JZMgbCpIkSZIk/dsC2Jl9O8FdAEaAuQDuAjACzAVwF4ARYC6AuwCMAB4RuAvACOB5hbsAjABzAdwFYASYC+AuACPAR4W7AIwAHhXuAjACeFbhLgAAAP8BHvUY6L0n6T0AAAAASUVORK5CYII=',
  // Зелёная галочка (успех)
  success: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABxSURBVFiF7dYxCoAwFEXRe/1btcDCQrBRcGDhKAKDuP8BZpIpbwj8N3+GCyEIIeRfF8DO7NsJ7gIwAswFcBeAEWAugLsAjABzAdwFYATwiMBdAEYAjyvcBWAE8LjCXQBGAI8r3AVgBPCowl0A+v8X7gIwAnhU4S4AAPgGmK0Y8R6sE+oAAAAASUVORK5CYII=',
  // Красный крестик (ошибка)
  error: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAB0SURBVFiF7dYxCsAgDEbh3P/W1kHBCxRG0FZx8K8JZMgbCpIkSZIk/dsC2Jl9O8FdAEaAuQDuAjACzAVwF4ARYC6AuwCMAB4RuAvACOB5hbsAjABzAdwFYASYC+AuACPAR4W7AIwAHhXuAjACeFbhLgAAAP8BHvUY6L0n6T0AAAAASUVORK5CYII=',
};

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let tray;
let status = {
  lastCheck: null,
  lastSuccess: null,
  lastError: null,
  filesCount: 0,
};
let retryTask = null;

// === ЛОГИРОВАНИЕ ===
async function log(level, message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}\n`;
  console.log(entry.trim());
  try {
    await fs.mkdir(path.dirname(CONFIG.logFile), { recursive: true });
    await fs.appendFile(CONFIG.logFile, entry);
  } catch (e) {
    console.error('Ошибка записи лога:', e.message);
  }
}

// === СТАТУС ===
async function saveStatus() {
  try {
    await fs.writeFile(CONFIG.statusFile, JSON.stringify(status, null, 2));
  } catch (e) {
    log('WARN', `Не удалось сохранить статус: ${e.message}`);
  }
}

// === УВЕДОМЛЕНИЯ ===
function showNotification(title, message, type = 'Information') {
  const icons = { Information: 'Info', Warning: 'Warning', Error: 'Error' };
  const icon = icons[type] || 'Info';
  const ps = `Add-Type -AssemblyName System.Windows.Forms; ` +
    `[System.Windows.Forms.MessageBox]::Show("${message.replace(/"/g, '`"')}", "${title}", "OK", "${icon}")`;
  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'ignore', windowsHide: false });
  } catch (e) {
    log('WARN', `Не удалось показать уведомление: ${e.message}`);
  }
}

// === ИКОНКА В ТРЕЕ ===
function initTray() {
  const menu = {
    icon: ICONS.waiting,
    title: 'SberAuto',
    tooltip: 'СберАвто — ожидание...',
    items: [
      {
        title: 'Проверить сейчас',
        tooltip: 'Запустить проверку почты немедленно',
        enabled: true,
      },
      {
        title: 'Открыть папку',
        tooltip: `Папка с выписками: ${CONFIG.downloadDir}`,
        enabled: true,
      },
      {
        title: 'Последний лог',
        tooltip: 'Открыть лог-файл',
        enabled: true,
      },
      { type: 'separator' },
      {
        title: 'Статус',
        tooltip: 'Информация о последнем запуске',
        enabled: false,
      },
      { type: 'separator' },
      {
        title: 'Выход',
        tooltip: 'Завершить работу SberAuto',
        enabled: true,
      },
    ],
  };

  tray = new SysTray({ menu, debug: false });

  tray.on('click', (action) => {
    switch (action.item.title) {
      case 'Проверить сейчас':
        log('INFO', 'Ручной запуск проверки');
        checkAndDownload();
        break;
      case 'Открыть папку':
        execSync(`explorer "${CONFIG.downloadDir}"`, { stdio: 'ignore' });
        break;
      case 'Последний лог':
        execSync(`notepad "${CONFIG.logFile}"`, { stdio: 'ignore' });
        break;
      case 'Выход':
        log('INFO', 'Пользователь запросил выход');
        tray.kill();
        process.exit(0);
        break;
    }
  });
}

function updateTray(iconStatus, tooltip) {
  if (!tray) return;
  tray.sendAction({
    type: 'update-menu',
    menu: {
      icon: ICONS[iconStatus] || ICONS.waiting,
      title: 'SberAuto',
      tooltip: tooltip || 'СберАвто',
      items: tray._menu.items,
    },
  });
}

// === MAGIC BYTES ===
function isValidXlsx(buffer) {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
}

// === ПАРСИНГ ПИСЬМА ===
function parseEmail(html) {
  const $ = cheerio.load(html);
  
  const link = $('a:contains("Скачать выписку")').attr('href') 
            || $('a:contains("скачать выписку")').attr('href')
            || $('a:contains("Скачать")').attr('href');
  
  if (!link) return { link: null, fileName: null };
  
  let dateStr = null;
  $('td').each((i, td) => {
    const text = $(td).text().trim();
    if (text.toLowerCase().includes('период')) {
      const nextCell = $(td).next('td').text().trim();
      const match = nextCell.match(/(\d{2}\.\d{2}\.\d{4})/);
      if (match) dateStr = match[1];
    }
  });
  
  let fileName;
  if (dateStr) {
    const [d, m, y] = dateStr.split('.');
    fileName = `Sber_Statement_${y}-${m}-${d}.xlsx`;
  } else {
    const today = new Date();
    fileName = `Sber_Statement_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.xlsx`;
  }
  
  return { link, fileName };
}

// === СКАЧИВАНИЕ ===
async function downloadFile(url, filePath) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  
  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}`, status: response.status };
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  
  if (!isValidXlsx(buffer)) {
    return { success: false, error: 'Получен не XLSX-файл', status: response.status };
  }
  
  await fs.writeFile(filePath, buffer);
  return { success: true, size: buffer.length };
}

// === ОСНОВНАЯ ЛОГИКА ===
async function checkAndDownload() {
  updateTray('waiting', 'Проверка почты...');
  await log('INFO', '=== Запуск проверки ===');
  
  let client;
  let hadNetworkError = false;
  let expiredLinkCount = 0;
  let successCount = 0;
  
  try {
    await fs.mkdir(CONFIG.downloadDir, { recursive: true });
    
    client = new ImapFlow(CONFIG.imap);
    await client.connect();
    await log('INFO', 'Подключено к IMAP');
    
    const lock = await client.getMailboxLock('INBOX');
    
    try {
      const searchResult = await client.search({
        unseen: true,
        subject: 'Выписка по счету',
      }, { uid: true });
      
      if (searchResult.length === 0) {
        await log('INFO', 'Нет новых писем с выпиской');
        status.lastCheck = new Date().toISOString();
        await saveStatus();
        updateTray('success', `Последняя проверка: ${new Date().toLocaleString('ru-RU')}. Новых писем нет.`);
        return;
      }
      
      await log('INFO', `Найдено писем: ${searchResult.length}`);
      
      for (const uid of searchResult) {
        const download = client.fetch(uid, { source: true });
        let emailSource = '';
        
        for await (const chunk of download) {
          emailSource += chunk.source.toString();
        }
        
        const htmlMatch = emailSource.match(/<html[\s\S]*?<\/html>/i);
        if (!htmlMatch) {
          await log('WARN', `UID ${uid}: HTML не найден`);
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          continue;
        }
        
        const { link, fileName } = parseEmail(htmlMatch[0]);
        
        if (!link) {
          await log('WARN', `UID ${uid}: ссылка не найдена`);
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          continue;
        }
        
        const filePath = path.join(CONFIG.downloadDir, fileName);
        
        if (fsSync.existsSync(filePath)) {
          const stat = fsSync.statSync(filePath);
          if (stat.size > 0) {
            await log('INFO', `${fileName}: уже существует`);
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            continue;
          }
        }
        
        // HEAD-проверка
        try {
          const headResp = await fetch(link, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          
          if ([403, 404, 410].includes(headResp.status)) {
            await log('ERROR', `${fileName}: ❌ ссылка истекла (HTTP ${headResp.status})`);
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            expiredLinkCount++;
            continue;
          }
        } catch (e) {
          await log('WARN', `HEAD-запрос упал: ${e.message}`);
        }
        
        // Скачивание
        await log('INFO', `Скачивание: ${fileName}`);
        const result = await downloadFile(link, filePath);
        
        if (result.success) {
          await log('INFO', `✅ ${fileName}: сохранено (${result.size} байт)`);
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          successCount++;
        } else {
          await log('ERROR', `❌ ${fileName}: ${result.error}`);
          
          if ([403, 404, 410].includes(result.status)) {
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            expiredLinkCount++;
          } else {
            hadNetworkError = true;
            break;
          }
        }
      }
    } finally {
      lock.release();
    }
    
    await client.logout();
    
  } catch (err) {
    await log('ERROR', `Критическая ошибка: ${err.message}`);
    hadNetworkError = true;
    
    if (client) {
      try { await client.logout(); } catch (e) {}
    }
  }
  
  // Обновляем статус
  status.lastCheck = new Date().toISOString();
  if (successCount > 0) {
    status.lastSuccess = new Date().toISOString();
  }
  if (hadNetworkError || expiredLinkCount > 0) {
    status.lastError = {
      time: new Date().toISOString(),
      message: hadNetworkError ? 'Сетевая ошибка' : `Протухших ссылок: ${expiredLinkCount}`,
    };
  }
  
  try {
    const files = await fs.readdir(CONFIG.downloadDir);
    status.filesCount = files.filter(f => f.endsWith('.xlsx')).length;
  } catch (e) {
    status.filesCount = 0;
  }
  
  await saveStatus();
  
  // Уведомления и статус иконки
  if (expiredLinkCount > 0) {
    showNotification(
      'SberAuto — проблема',
      `Не удалось скачать ${expiredLinkCount} выписок: ссылки истекли.\n\nПроверьте: ${CONFIG.logFile}`,
      'Warning'
    );
    updateTray('error', `⚠️ Протухших ссылок: ${expiredLinkCount}. Кликните для деталей.`);
  } else if (hadNetworkError) {
    showNotification(
      'SberAuto — ошибка сети',
      `Не удалось подключиться. Следующая попытка через ${CONFIG.retryHours} часа.\n\nПроверьте: ${CONFIG.logFile}`,
      'Error'
    );
    updateTray('error', `❌ Сетевая ошибка. Повтор через ${CONFIG.retryHours} ч.`);
    
    // Запланировать повтор через 3 часа
    if (retryTask) retryTask.stop();
    retryTask = cron.schedule(`0 */${CONFIG.retryHours} * * *`, async () => {
      log('INFO', 'Автоматический повтор после ошибки');
      await checkAndDownload();
      if (retryTask) {
        retryTask.stop();
        retryTask = null;
      }
    });
  } else {
    const msg = `✅ Последняя проверка: ${new Date().toLocaleString('ru-RU')}. Файлов: ${status.filesCount}.`;
    updateTray('success', msg);
  }
}

// === ГЛАВНАЯ ФУНКЦИЯ ===
async function main() {
  // Проверка окружения
  const required = ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASS'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Не заданы переменные в .env: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  await log('INFO', '========================================');
  await log('INFO', 'SberAuto запущен');
  await log('INFO', `Почта: ${CONFIG.imap.auth.user}`);
  await log('INFO', `Папка: ${CONFIG.downloadDir}`);
  await log('INFO', `Время проверки: ежедневно в ${CONFIG.successTime}`);
  await log('INFO', '========================================');
  
  // Инициализация иконки
  initTray();
  updateTray('waiting', 'SberAuto запущен. Ожидание...');
  
  // Первая проверка при старте
  await checkAndDownload();
  
  // Ежедневная проверка в указанное время
  const [hh, mm] = CONFIG.successTime.split(':');
  cron.schedule(`${mm} ${hh} * * *`, async () => {
    await log('INFO', 'Сработал ежедневный триггер');
    await checkAndDownload();
  });
  
  await log('INFO', `Ежедневный триггер установлен на ${CONFIG.successTime}`);
}

// Обработка сигналов завершения
process.on('SIGINT', () => {
  log('INFO', 'Получен SIGINT, завершение...');
  if (tray) tray.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'Получен SIGTERM, завершение...');
  if (tray) tray.kill();
  process.exit(0);
});

main().catch(err => {
  console.error('Unhandled error:', err);
  if (tray) tray.kill();
  process.exit(1);
});