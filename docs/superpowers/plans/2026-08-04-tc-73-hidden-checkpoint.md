# TC-73 Hidden Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в общий Playwright-прогон TC-73, который доказывает, что скрытая точка не создаёт тайм-слоты, но может обслужить запись, появившуюся благодаря обычной точке.

**Architecture:** Тест размещается рядом с существующими Kiwi-кейсами точек обслуживания. UI запуска точек и обслуживания позиции остаётся в `checkpoint-cases.spec.ts`, а повторяемый сценарий просмотра и создания записи на сегодня добавляется в `setup/admin-line-monitoring.mjs`. Состояние точек и слотов дополнительно проверяется через существующие административные API.

**Tech Stack:** TypeScript, Playwright Test, JavaScript ESM helpers, Kiwi TCMS metadata, Backoffice REST API.

## Global Constraints

- Устаревшие варианты расписания из примечания TC-73 не проверяются.
- Основные действия с точкой выполняются через `data-test` локаторы.
- При единственной активной скрытой точке список тайм-слотов на текущую дату должен быть пуст.
- После запуска обычной точки слот должен появиться, запись должна создаваться через UI и полностью обслуживаться скрытой точкой.
- Все созданные точки и позиции должны регистрироваться в `.e2e-stand-state.json` и очищаться даже при падении теста.
- Флаг `is_automated` в Kiwi не менять до пользовательской проверки видео.

---

### Task 1: Добавить падающий сценарий TC-73

**Files:**
- Modify: `specs/admin/checkpoint-cases.spec.ts`

**Interfaces:**
- Consumes: `createFixtureCheckpoint(page, caseId)`, `registerPosition(positionId)`, `startCheckpoint(page, checkpoint, mode, schedule)`, `stopCheckpoint(page, checkpoint, reason)` и локальные действия обслуживания позиции.
- Produces: Playwright-тест `TC-73 starts a hidden service point without adding booking capacity`, задающий требуемые интерфейсы `startHiddenCheckpoint`, `inspectTodayAppointmentSlots` и `createTodayAppointment`.

- [ ] **Step 1: Подготовить чистый стенд**

Run:

```powershell
pnpm stand:prepare
```

Expected: создан `.e2e-stand-state.json`, сценарий `stoppedCheckpoint` содержит выключенную очередь с одной услугой.

- [ ] **Step 2: Написать тест требуемого поведения до реализации помощников**

Добавить импорт будущих функций:

```ts
import {
  createTodayAppointment,
  expectPositionAbsentFromLineMonitoring,
  inspectTodayAppointmentSlots,
  loginAdmin
} from '../../setup/admin-line-monitoring.mjs'
```

Добавить тест со следующей структурой:

```ts
test('TC-73 starts a hidden service point without adding booking capacity', async ({ page }) => {
  test.setTimeout(300_000)
  const item = scenario()
  const suffix = String(Date.now()).slice(-6)
  const person = {
    firstName: 'Hidden',
    lastName: `Checkpoint${suffix}`,
    phone: `+7900${String(Date.now()).slice(-7)}`,
    email: `tc73-${suffix}@example.com`
  }
  let hiddenCheckpoint: PreparedCheckpoint | undefined
  let normalCheckpoint: PreparedCheckpoint | undefined
  let positionId = 0

  await loginAdmin(page)
  hiddenCheckpoint = await createFixtureCheckpoint(page, 73)
  normalCheckpoint = await createFixtureCheckpoint(page, 730)

  try {
    const hidden = await startHiddenCheckpoint(page, hiddenCheckpoint)
    expect(hidden.status).toBe('started')
    expect(hidden.isHidden).toBe(true)
    await expectHiddenCheckpointServices(page, hiddenCheckpoint, item.serviceId)

    const hiddenOnlySlots = await inspectTodayAppointmentSlots(page, item)
    expect(hiddenOnlySlots.times).toEqual([])
    expect(hiddenOnlySlots.noSlotsVisible).toBe(true)

    const normal = await startCheckpoint(page, normalCheckpoint, 'fixed', { allDay: true })
    expect(normal.status).toBe('started')
    expect(normal.isHidden).not.toBe(true)

    const availableSlots = await inspectTodayAppointmentSlots(page, item)
    expect(availableSlots.times.length).toBeGreaterThan(0)

    positionId = await createTodayAppointment(page, item, person)
    registerPosition(positionId)
    await completePositionAtCheckpoint(page, hiddenCheckpoint, positionId, person)
    await expectPositionAbsentFromLineMonitoring(page, item, positionId)
  } finally {
    if (positionId && hiddenCheckpoint) {
      await removePositionIfPresent(page, item, hiddenCheckpoint, positionId)
    }
    if (normalCheckpoint) {
      await stopCheckpoint(page, normalCheckpoint, 'TC-73: завершение обычной точки').catch(() => {})
    }
    if (hiddenCheckpoint) {
      await stopCheckpoint(page, hiddenCheckpoint, 'TC-73: завершение скрытой точки').catch(() => {})
    }
  }
})
```

- [ ] **Step 3: Запустить тест и подтвердить RED**

Run:

```powershell
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts --project=chromium --workers=1 --grep "TC-73"
```

Expected: тест не проходит, потому что `createTodayAppointment`/`inspectTodayAppointmentSlots` ещё не экспортируются и скрытый запуск ещё не реализован. Ошибка должна относиться к отсутствующему поведению, а не к подготовке стенда или авторизации.

- [ ] **Step 4: Сохранить RED-изменение**

```powershell
git add e2e/specs/admin/checkpoint-cases.spec.ts
git commit -m "test(e2e): specify TC-73 hidden checkpoint behavior"
```

---

### Task 2: Реализовать работу с сегодняшними слотами и записью

**Files:**
- Modify: `setup/admin-line-monitoring.mjs`
- Test: `specs/admin/checkpoint-cases.spec.ts`

**Interfaces:**
- Produces: `inspectTodayAppointmentSlots(page, scenario): Promise<{ times: string[]; noSlotsVisible: boolean }>`.
- Produces: `createTodayAppointment(page, scenario, person): Promise<number>`.
- Both helpers use `/api/positionsManagement/getServiceDateTimes` and the existing appointment wizard.

- [ ] **Step 1: Выделить приватное открытие шага выбора времени**

Добавить `openTodayAppointmentTimeStep(page, scenario)`, который:

```js
await open(page, adminUrl(), `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointments`)
await page.getByRole('button', { name: /^Добавить запись$/i }).first().click()
await expect(page.getByRole('heading', { name: 'Выбор очереди и услуги' })).toBeVisible()
const responsePromise = waitJsonResponse(page, '/api/positionsManagement/getServiceDateTimes', ['POST'])
await clickButton(page, nextButton)
const body = await responsePromise
await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible()
```

Нормализовать `body.times`/`body.data.times`, отфильтровать `startTime` по текущей дате в `Asia/Yekaterinburg` и вернуть тело ответа вместе с локальными временами `HH:mm`.

- [ ] **Step 2: Реализовать чтение слотов без создания записи**

`inspectTodayAppointmentSlots` должен:

- открыть шаг времени;
- вернуть времена только текущей даты;
- проверить видимость `Нет свободного времени для записи`, когда массив пуст;
- при непустом массиве проверить отображение хотя бы одного возвращённого времени;
- закрыть форму через `Escape` и подтвердить `Да, закрыть`, если появится предупреждение о несохранённых данных.

- [ ] **Step 3: Реализовать создание записи на сегодня**

`createTodayAppointment` должен повторно открыть шаг времени, выбрать последний доступный слот текущего дня, заполнить фамилию, имя, email и телефон существующими `fillField`/`fillPhoneField`, отправить `/api/positionsManagement/editForm`, проверить `isAppointment === true` и вернуть `positionId`.

- [ ] **Step 4: Запустить TC-73 и подтвердить следующий ожидаемый RED**

Run ту же команду с `--grep "TC-73"`.

Expected: импорты и работа со слотами больше не являются причиной падения; тест останавливается на ещё не реализованном скрытом запуске или проверке обслуживания.

- [ ] **Step 5: Сохранить помощники**

```powershell
git add e2e/setup/admin-line-monitoring.mjs e2e/specs/admin/checkpoint-cases.spec.ts
git commit -m "test(e2e): add current-day appointment helpers"
```

---

### Task 3: Реализовать скрытый запуск и обслуживание позиции

**Files:**
- Modify: `specs/admin/checkpoint-cases.spec.ts`

**Interfaces:**
- Produces: `startHiddenCheckpoint(page, checkpoint)` returning the matching `/api/GetCheckpointList` item.
- Produces: `expectHiddenCheckpointServices(page, checkpoint, serviceId)` using `/api/getCheckpointMonitoring`.
- Produces: `completePositionAtCheckpoint(page, checkpoint, positionId, person)` reusing the existing validation and position action helpers.
- Produces: `removePositionIfPresent(page, scenario, checkpoint, positionId)` for idempotent cleanup.

- [ ] **Step 1: Реализовать скрытый запуск через текущий UI**

`startHiddenCheckpoint` должен:

```ts
await openCheckpointHost(page, checkpoint)
await expect(page.locator('[data-test="CheckpointHost-Action-startHidden"]')).toBeVisible()
await page.locator('[data-test="CheckpointHost-Action-startHidden"]').click()
await page.locator('[data-test="CheckpointHost-WorkScheduleMode-fixed"]').click()
await setAllDay(page, true)
await fillControl(page, 'CheckpointHost-ReasonHiddenStart', 'TC-73: скрытый запуск')
await selectAllServices(page)
await applyHostSettings(page)
```

Если `CheckpointHost-HiddenStartAllowCreatePosition` присутствует в текущем интерфейсе, установить переключатель в активное состояние и проверить его состояние до сохранения. После сохранения опрашивать список точек до `status === "started" && isHidden === true`.

- [ ] **Step 2: Проверить применённую услугу**

Получить `/api/getCheckpointMonitoring?id=<checkpointId>`, извлечь `enabledServices` и проверить наличие `serviceId`. Это отделяет проверку настроек запуска от сокращённой модели `/api/GetCheckpointList`.

- [ ] **Step 3: Реализовать полный цикл на скрытой точке**

`completePositionAtCheckpoint` открывает маршрут `/shops/{shopId}/lines/{lineId}/checkpoints/{checkpointId}/monitoring`, находит карточку по уникальной фамилии и последовательно вызывает существующие функции:

```ts
await validatePosition(page)
await clickPositionAction(page, 'Вызвать')
await clickPositionAction(page, 'Начать обслуживание')
await clickPositionAction(page, 'Закончить обслуживание')
```

После каждого действия проверять соответствующий текущий/disabled-статус, как в TC-53.

- [ ] **Step 4: Реализовать идемпотентную очистку позиции**

При незавершённой позиции отправлять `/api/changePositionState` с `newState: "removed"`. Ошибку отсутствующей уже завершённой позиции поглощать только внутри `finally`.

- [ ] **Step 5: Запустить TC-73 и подтвердить GREEN**

Run:

```powershell
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts --project=chromium --workers=1 --grep "TC-73"
```

Expected: `1 passed`; до обычного запуска сегодняшние слоты пусты, после запуска появляются, позиция полностью обслуживается скрытой точкой.

- [ ] **Step 6: Запустить регрессию файла**

Run:

```powershell
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts --project=chromium --workers=1
```

Expected: все 9 кейсов файла проходят.

- [ ] **Step 7: Сохранить реализацию**

```powershell
git add e2e/specs/admin/checkpoint-cases.spec.ts
git commit -m "test(e2e): automate Kiwi TC-73 hidden checkpoint"
```

---

### Task 4: Обновить каталог тестов, записать видео и очистить стенд

**Files:**
- Modify: `TESTS.md`
- Create: `artifacts/kiwi-checkpoints/TC-73-hidden-checkpoint.webm`

**Interfaces:**
- Consumes: успешный TC-73 и Playwright video configuration.
- Produces: актуальный каталог на 173 теста и отдельное видео TC-73.

- [ ] **Step 1: Обновить счётчики и описание**

Изменить:

- общее количество `172` → `173`;
- функциональные административные тесты `20` → `21`;
- группу Kiwi-кейсов точек `8` → `9`;
- добавить описание TC-73 с обеими фазами проверки слотов и обслуживанием на скрытой точке.

- [ ] **Step 2: Проверить список тестов и форматирование**

Run:

```powershell
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts --list
git diff --check
```

Expected: `Total: 9 tests in 1 file`, ошибок форматирования нет.

- [ ] **Step 3: Записать отдельное видео**

Run:

```powershell
$env:STAND_VIDEO='on'
$env:STAND_SLOW_MO_MS='250'
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts --project=chromium --workers=1 --grep "TC-73"
```

Expected: `1 passed`, в `test-results` создан `video.webm`. Скопировать его в `artifacts/kiwi-checkpoints/TC-73-hidden-checkpoint.webm`.

- [ ] **Step 4: Очистить стенд**

Run:

```powershell
pnpm stand:cleanup
```

Expected: команда сообщает удалённый `runId`, `.e2e-stand-state.json` отсутствует, созданные точки и позиция удалены.

- [ ] **Step 5: Финальная проверка**

Run:

```powershell
git diff --check
git status --short
```

Проверить наличие видео и убедиться, что `is_automated` у TC-73 в Kiwi всё ещё `false`.

- [ ] **Step 6: Сохранить документацию и видео**

```powershell
git add e2e/TESTS.md e2e/artifacts/kiwi-checkpoints/TC-73-hidden-checkpoint.webm
git commit -m "docs(e2e): document TC-73 automation"
```
