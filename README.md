<p align="center">
  <a href="https://nodejs.org"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-v24+-339933?logo=node.js&logoColor=white"></a>
  <a href="https://github.com/AlexanderKuzikov/SberBusiness/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-blue"></a>
</p>

<h1 align="center">SberBusiness</h1>
<p align="center">Мониторинг СберБизнес: IMAP, XLSX, трей, планировщик</p>

---

Мониторинг уведомлений СберБизнес: парсинг IMAP-писем, валидация XLSX-вложений, системный трей и планировщик проверок.

- **IMAP-парсинг** — чтение писем через imapflow.
- **XLSX-валидация** — проверка вложений на корректность.
- **Системный трей** — фоновая работа через systray2.

## Быстрый старт

```bash
git clone https://github.com/AlexanderKuzikov/SberBusiness.git
cd SberBusiness
npm install
node index.js
```

## Документация

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — состояние проекта
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — архитектурные решения

## Статус

**v1.0.0** — работает.

## Лицензия

[Apache-2.0](LICENSE) © Alexander Kuzikov
