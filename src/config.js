import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    config: null,
    once: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--once') {
      args.once = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) throw new Error('--config требует путь к файлу');
      args.config = value;
      i += 1;
    } else if (arg.startsWith('--config=')) {
      args.config = arg.slice('--config='.length);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  return args;
}

export function cliHelp() {
  return `SberBusiness

Usage:
  node --env-file=.env index.js [options]

Options:
  --config <path>   Path to config JSON. Default: ./config.json
  --once            Run one IMAP check and exit
  --dry-run         Validate config and print redacted runtime config
  -h, --help        Show this help
`;
}

function readJsonFile(filePath) {
  return fs.readFile(filePath, 'utf8').then((content) => JSON.parse(content));
}

function applyEnv(base, env = process.env) {
  const next = structuredClone(base);

  if (env.IMAP_HOST) next.imap.host = env.IMAP_HOST.trim();
  if (env.IMAP_PORT) next.imap.port = Number(env.IMAP_PORT);
  if (env.IMAP_SECURE !== undefined) next.imap.secure = env.IMAP_SECURE !== 'false';
  if (env.IMAP_USER) next.imap.auth.user = env.IMAP_USER.trim();
  if (env.IMAP_PASS) next.imap.auth.pass = env.IMAP_PASS;
  if (env.IMAP_MAILBOX) next.mailbox = env.IMAP_MAILBOX.trim();
  if (env.IMAP_SUBJECT || env.SEARCH_SUBJECT) next.search.subject = (env.SEARCH_SUBJECT || env.IMAP_SUBJECT).trim();
  if (env.DOWNLOAD_DIR) next.downloadDir = env.DOWNLOAD_DIR.trim();
  if (env.SUCCESS_TIME) next.successTime = env.SUCCESS_TIME.trim();
  if (env.RETRY_HOURS) next.retryHours = Number(env.RETRY_HOURS);
  if (env.LOG_DIR) next.logs.dir = env.LOG_DIR.trim();
  if (env.LOG_FILE) next.logs.file = env.LOG_FILE.trim();
  if (env.STATUS_FILE) next.logs.statusFile = env.STATUS_FILE.trim();
  if (env.HEAD_TIMEOUT_MS) next.download.headTimeoutMs = Number(env.HEAD_TIMEOUT_MS);
  if (env.DOWNLOAD_TIMEOUT_MS) next.download.timeoutMs = Number(env.DOWNLOAD_TIMEOUT_MS);
  if (env.TRAY_ENABLED !== undefined) next.tray.enabled = env.TRAY_ENABLED !== 'false';

  return next;
}

function isInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateConfig(config) {
  assertCondition(config && typeof config === 'object', 'config.json должен быть объектом');
  assertCondition(typeof config.imap?.host === 'string' && config.imap.host.length > 0, 'imap.host обязателен');
  assertCondition(isInteger(config.imap.port), 'imap.port должен быть целым числом');
  assertCondition(config.imap.port >= 1 && config.imap.port <= 65535, 'imap.port должен быть в диапазоне 1..65535');
  assertCondition(typeof config.imap?.auth?.user === 'string' && config.imap.auth.user.length > 0, 'IMAP_USER обязателен');
  assertCondition(typeof config.imap?.auth?.pass === 'string' && config.imap.auth.pass.length > 0, 'IMAP_PASS обязателен');
  assertCondition(typeof config.mailbox === 'string' && config.mailbox.length > 0, 'mailbox обязателен');
  assertCondition(typeof config.search?.subject === 'string' && config.search.subject.length > 0, 'search.subject обязателен');
  assertCondition(typeof config.downloadDir === 'string' && config.downloadDir.length > 0, 'downloadDir обязателен');
  assertCondition(/^([01]\d|2[0-3]):[0-5]\d$/.test(config.successTime), 'successTime должен быть в формате HH:MM');
  assertCondition(isInteger(config.retryHours), 'retryHours должен быть целым числом');
  assertCondition(config.retryHours >= 1 && config.retryHours <= 23, 'retryHours должен быть в диапазоне 1..23');
  assertCondition(typeof config.logs?.dir === 'string' && config.logs.dir.length > 0, 'logs.dir обязателен');
  assertCondition(typeof config.logs?.file === 'string' && config.logs.file.length > 0, 'logs.file обязателен');
  assertCondition(typeof config.logs?.statusFile === 'string' && config.logs.statusFile.length > 0, 'logs.statusFile обязателен');
  assertCondition(isInteger(config.download?.headTimeoutMs), 'download.headTimeoutMs должен быть целым числом');
  assertCondition(isInteger(config.download?.timeoutMs), 'download.timeoutMs должен быть целым числом');
  assertCondition(config.download.headTimeoutMs > 0, 'download.headTimeoutMs должен быть > 0');
  assertCondition(config.download.timeoutMs > 0, 'download.timeoutMs должен быть > 0');
  assertCondition(typeof config.tray?.enabled === 'boolean', 'tray.enabled должен быть boolean');
  assertCondition(typeof config.tray?.title === 'string' && config.tray.title.length > 0, 'tray.title обязателен');

  return true;
}

export async function loadConfig(configPath) {
  const resolvedPath = configPath ? path.resolve(configPath) : path.join(PROJECT_ROOT, 'config.json');
  let fileConfig = {};

  try {
    fileConfig = await readJsonFile(resolvedPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const config = applyEnv(fileConfig);
  validateConfig(config);

  return { config, configPath: resolvedPath };
}

export function resolveRuntimePaths(config, root = PROJECT_ROOT) {
  const logsDir = path.resolve(root, config.logs.dir);
  return {
    ...config,
    logs: {
      ...config.logs,
      dir: logsDir,
    },
    logFile: path.join(logsDir, config.logs.file),
    statusFile: path.join(logsDir, config.logs.statusFile),
  };
}

export function redactConfig(config) {
  return {
    ...structuredClone(config),
    imap: {
      ...config.imap,
      auth: {
        ...config.imap.auth,
        pass: '<redacted>',
      },
    },
  };
}
