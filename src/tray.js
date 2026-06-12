import { execFile } from 'node:child_process';
import systrayModule from 'systray2';

const SysTray = systrayModule.default || systrayModule;

export const ICONS = {
  waiting: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABjSURBVFiF7dYxCgAgDEPR3P/W1kHBCxRG0FZx8K8JZMgbCpIkSZIk/dsC2Jl9O8FdAEaAuQDuAjACzAVwF4ARYC6AuwCMAB4RuAvACOB5hbsAjABzAdwFYASYC+AuACPAR4W7AIwAHhXuAjACeFbhLgAAAP8BHvUY6L0n6T0AAAAASUVORK5CYII=',
  success: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABxSURBVFiF7dYxCoAwFEXRe/1btcDCQrBRcGDhKAKDuP8BZpIpbwj8N3+GCyEIIeRfF8DO7NsJ7gIwAswFcBeAEWAugLsAjABzAdwFYATwiMBdAEYAjyvcBWAE8LjCXQBGAI8r3AVgBPCowl0A+v8X7gIwAnhU4S4AAPgGmK0Y8R6sE+oAAAAASUVORK5CYII=',
  error: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAABYgAAAWIB1QYfOAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAB0SURBVFiF7dYxCsAgDEbh3P/W1kHBCxRG0FZx8K8JZMgbCpIkSZIk/dsC2Jl9O8FdAEaAuQDuAjACzAVwF4ARYC6AuwCMAB4RuAvACOB5hbsAjABzAdwFYASYC+AuACPAR4W7AIwAHhXuAjACeFbhLgAAAP8BHvUY6L0n6T0AAAAASUVORK5CYII=',
};

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function showNotification(title, message, type = 'Information') {
  const icons = { Information: 'Info', Warning: 'Warning', Error: 'Error' };
  const icon = icons[type] || 'Info';
  const ps = `Add-Type -AssemblyName System.Windows.Forms; `
    + `[System.Windows.Forms.MessageBox]::Show(${psQuote(message)}, ${psQuote(title)}, 'OK', '${icon}')`;

  execFile('powershell', ['-NoProfile', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function createMenu(config, statusText) {
  return {
    icon: config.currentIcon || ICONS.waiting,
    title: config.tray.title,
    tooltip: statusText || config.tray.tooltip,
    items: [
      {
        title: 'Проверить сейчас',
        tooltip: 'Запустить проверку почты немедленно',
        enabled: true,
      },
      {
        title: 'Открыть папку',
        tooltip: `Папка с выписками: ${config.downloadDir}`,
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
        tooltip: 'Завершить работу SberBusiness',
        enabled: true,
      },
    ],
  };
}

function openPath(targetPath) {
  if (process.platform !== 'win32') return;
  execFile(targetPath.includes('\\') ? 'explorer.exe' : 'open', [targetPath], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

export async function initTray({ config, log, onCheckNow, onExit }) {
  const tray = new SysTray({
    menu: createMenu(config, config.tray.tooltip),
    debug: false,
  });

  await tray.ready();
  await tray.onClick(async (action) => {
    switch (action.item.title) {
      case 'Проверить сейчас':
        log('INFO', 'Ручной запуск проверки');
        await onCheckNow();
        break;
      case 'Открыть папку':
        openPath(config.downloadDir);
        break;
      case 'Последний лог':
        openPath(config.logFile);
        break;
      case 'Выход':
        log('INFO', 'Пользователь запросил выход');
        await onExit();
        break;
      default:
        break;
    }
  });

  return {
    async update(statusText, iconStatus = 'waiting') {
      await tray.sendAction({
        type: 'update-menu',
        menu: createMenu(
          { ...config, currentIcon: ICONS[iconStatus] || ICONS.waiting },
          statusText,
        ),
      });
    },
    async close() {
      tray.kill();
    },
  };
}
