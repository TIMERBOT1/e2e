# VneOcheredi E2E

Автотесты Playwright для административного интерфейса и терминала. Репозиторий
работает против уже развернутого стенда; приложение и исходники основного
репозитория для запуска не требуются.

## Быстрый старт

```bash
npm install -g pnpm@10.12.4
pnpm install --frozen-lockfile
npx playwright install --with-deps chromium
copy .env.stand.example .env.stand.local
# заполнить .env.stand.local
pnpm full:cycle
```

Для Linux/macOS вместо `copy` используйте `cp`.

Перед тестами `stand:prepare` создаёт временные сущности на стенде, а
`stand:cleanup` удаляет их. Для CI используйте `full:cycle`, чтобы очистка
выполнялась и при падении тестов.

Полный сгруппированный список сценариев: [TESTS.md](./TESTS.md).

```bash
npm run stand:cycle
npm run stand:prepare
npm test
npm run stand:cleanup
npm run test:video
```

## Переменные окружения

Обязательные значения: `ADMIN_URL`, `ADMIN_LOGIN`, `ADMIN_PASSWORD` и
`CALL_TERMINAL_BASE_URL`. Их можно задать в `.env.stand.local` локально или в
секретах CI. Файл с секретами не коммитится.

Проверки coverage-матриц (`admin:coverage:check` и
`permissions:coverage:check`) дополнительно анализируют исходники основного
приложения и поэтому запускаются только в checkout, где доступен этот код.

## CI

Workflow `.github/workflows/e2e.yml` запускается вручную или по расписанию.
Добавьте в Secrets репозитория `ADMIN_URL`, `ADMIN_LOGIN`,
`ADMIN_PASSWORD` и `CALL_TERMINAL_BASE_URL`. Отчёт Playwright, screenshots,
traces и videos сохраняются как артефакты каждого запуска.
