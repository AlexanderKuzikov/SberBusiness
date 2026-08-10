# SberBusiness — Instructions for AI Agents

## Commands
- Нет npm scripts. Запуск: `node <script>.mjs`

## Conventions
- Node.js v24+ ESM
- cheerio, imapflow, systray2, undici
- Мониторинг СберБизнес: IMAP парсинг, XLSX валидация
- Системный трей, планировщик

## Structure
- Корневые .mjs скрипты

## Do NOT touch
- `.env` — секреты
- `node_modules/`

## Documentation rules
- После работы — обнови docs/CONTEXT.md
- НЕ создавай новых файлов документации без разрешения
