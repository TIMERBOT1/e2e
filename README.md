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

Каждый functional E2E-тест через Playwright-фикстуру создаёт только свои
временные сущности и удаляет их после завершения теста. Внешние
`stand:prepare` и `stand:cleanup` для `e2e:test` не используются.
`smoke:cycle` и `permissions:cycle` управляют отдельными стендами своих групп,
а `full:cycle` последовательно запускает все три независимые группы.

Functional E2E по умолчанию выполняются двумя Playwright worker. Подготовка и
очистка используют общую авторизованную сессию внутри каждого worker, но данные
и состояние создаются отдельно для каждого теста. Число worker можно изменить
через `E2E_WORKERS`; для диагностического последовательного прогона в
PowerShell используйте `$env:E2E_WORKERS = '1'`.

Полный сгруппированный список сценариев: [TESTS.md](./TESTS.md).

```bash
pnpm e2e:test
pnpm smoke:cycle
pnpm permissions:cycle
pnpm full:cycle
pnpm test:video
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
Functional E2E распределяются по двум независимым CI shard. После завершения
обоих shard, независимо от результата, параллельно запускаются job route-smoke
и permissions.
Добавьте в Secrets репозитория `ADMIN_URL`, `ADMIN_LOGIN`,
`ADMIN_PASSWORD` и `CALL_TERMINAL_BASE_URL`. Отчёт Playwright, screenshots,
traces и videos сохраняются как артефакты каждого запуска.
