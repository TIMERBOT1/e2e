# Каталог E2E-тестов

Документ описывает все тесты, которые Playwright обнаруживает в каталоге `specs`.

Последняя сверка с `pnpm exec playwright test --list`: **17 августа 2026 года**.

Всего реализовано **178 тестов в 11 spec-файлах**:

| Группа | Количество |
| --- | ---: |
| Smoke: доступность маршрутов административной панели | 96 |
| Smoke: проверка прав доступа | 46 |
| Функциональные тесты административной панели | 26 |
| Функциональные тесты прав доступа | 3 |
| Функциональные тесты терминала | 7 |
| **Всего** | **178** |

Актуальный фактический список можно получить командой:

```bash
pnpm exec playwright test --list
```

## 1. Smoke-тесты

Smoke-тесты проверяют, что основные страницы открываются на подготовленных сущностях, необходимые API-запросы завершаются, ожидаемые элементы отображаются и права доступа действительно ограничивают маршруты и действия.

### 1.1. Доступность маршрутов административной панели

Источник: `specs/admin/coverage-smoke.spec.ts`.

Маршруты формируются из записей со статусом `smoke-only` в `setup/coverage-matrix.json`. Для каждого маршрута выполняется вход администратором, открытие страницы и проверка указанного в матрице API-запроса, текста или селектора. При таймауте открытия выполняется одна повторная попытка.

Полное название каждого теста имеет вид `admin coverage smoke <Nav...>`.

#### Главная страница — 1 тест

- `Nav.index()` — открытие главной страницы административной панели.

#### Бренды и шаблоны очередей — 13 тестов

- `Nav.brands()` — список брендов.
- `Nav.createBrand()` — форма создания бренда.
- `Nav.editBrand(':brandId')` — редактирование подготовленного бренда.
- `Nav.viewBrand(':brandId')` — просмотр подготовленного бренда.
- `Nav.createLineTemplate(':brandId')` — создание шаблона очереди в бренде.
- `Nav.editBrandNotifications(':brandId')` — настройки уведомлений бренда.
- `Nav.brandClients(':brandId')` — список клиентов бренда.
- `Nav.lineTemplates(':brandId')` — список шаблонов очередей бренда.
- `Nav.lineTemplate(':brandId', ':lineTemplateId')` — просмотр подготовленного шаблона.
- `Nav.lineTemplateEdit(':brandId', ':lineTemplateId')` — редактирование подготовленного шаблона.
- `Nav.editBrandRestrictions(':brandId')` — ограничения бренда.
- `Nav.editBrandIntegrations(':brandId')` — интеграции бренда.
- `Nav.lineTemplateSettings(':brandId', ':lineTemplateId')` — настройки подготовленного шаблона.

#### Шаблоны сообщений — 3 теста

- `Nav.messageTemplates()` — глобальный список шаблонов сообщений.
- `Nav.shopMessageTemplates(':placeId')` — шаблоны сообщений места.
- `Nav.lineMessageTemplates(':placeId', ':lineId')` — шаблоны сообщений очереди.

#### Предварительные записи — 9 тестов

- `Nav.appointmentPlaceList()` — выбор места для работы с предварительными записями.
- `Nav.createAppointment()` — общая форма создания предварительной записи.
- `Nav.createAppointmentLine(':shopId', ':lineId')` — создание записи в выбранной очереди.
- `Nav.createAppointmentFromService()` — поиск услуги и создание записи.
- `Nav.viewAppointment(':appointmentId')` — просмотр подготовленной записи.
- `Nav.editAppointment(':appointmentId')` — редактирование подготовленной записи.
- `Nav.appointments()` — общий список предварительных записей.
- `Nav.appointmentsLine(':shopId', ':lineId')` — список записей выбранной очереди.
- `Nav.viewAppointmentLine(':shopId', ':lineId', ':appointmentId')` — просмотр записи в контексте очереди.

#### Журналы и системные события — 3 теста

- `Nav.journal()` — журнал предварительных записей.
- `Nav.positionJournal()` — журнал позиций.
- `Nav.systemEvents()` — журнал системных событий.

#### Терминалы — 4 теста

- `Nav.createTerminal()` — форма создания терминала.
- `Nav.editTerminal(':terminalId')` — редактирование подготовленного терминала.
- `Nav.terminal(':terminalId')` — просмотр терминала.
- `Nav.terminals()` — список терминалов.

#### Кампании и рекламные материалы — 7 тестов

- `Nav.createAdvertisement(':campaignId')` — создание рекламного материала в кампании.
- `Nav.editAdvertisement(':campaignId', ':advertisementId')` — редактирование подготовленного рекламного материала.
- `Nav.advertisements(':campaignId')` — список рекламных материалов кампании.
- `Nav.createCampaign()` — создание кампании.
- `Nav.editCampaign(':campaignId', ':mode')` — редактирование подготовленной кампании.
- `Nav.campaign(':campaignId')` — просмотр кампании.
- `Nav.campaigns()` — список кампаний.

#### Пользователи — 3 теста

- `Nav.createUser()` — форма создания пользователя.
- `Nav.editUser(':userId')` — редактирование подготовленного пользователя.
- `Nav.users()` — список пользователей.

#### Маяки — 4 теста

- `Nav.createBeacon(':shopId')` — создание маяка в месте.
- `Nav.editBeacon(':shopId', ':beaconId')` — редактирование подготовленного маяка.
- `Nav.beacon(':shopId', ':beaconId')` — просмотр маяка.
- `Nav.beacons(':shopId')` — список маяков места.

#### Управление персоналом очереди — 3 теста

- `Nav.createLineStaffManagement(':shopId', ':lineId')` — создание настройки доступности персонала.
- `Nav.editLineStaffManagement(':shopId', ':lineId', ':managementId')` — редактирование настройки доступности.
- `Nav.lineStaffManagement(':shopId', ':lineId')` — список настроек доступности персонала.

#### Точки обслуживания — 12 тестов

- `Nav.checkpointHost(':shopId', ':lineId', ':checkpointId')` — рабочее место оператора точки обслуживания.
- `Nav.lineDelay(':shopId', ':lineId')` — управление задержкой очереди.
- `Nav.checkpointDelay(':shopId', ':lineId', ':checkpointId')` — управление задержкой точки обслуживания.
- `Nav.checkpointMonitoring(':shopId', ':lineId', ':checkpointId')` — мониторинг точки обслуживания.
- `Nav.checkpointMonitoringCreate(':placeId', ':lineId', ':checkpointId')` — создание позиции из мониторинга точки.
- `Nav.checkpointMonitoringEdit(':placeId', ':lineId', ':checkpointId', ':positionId')` — редактирование позиции из мониторинга точки.
- `Nav.checkpointMonitoringPosition(':shopId', ':lineId', ':checkpointId', ':positionId')` — просмотр позиции в мониторинге точки.
- `Nav.createCheckpoint(':shopId', ':lineId')` — создание точки обслуживания.
- `Nav.editCheckpoint(':shopId', ':lineId', ':checkpointId')` — редактирование точки обслуживания.
- `Nav.checkpointWorkSchedule(':shopId', ':lineId', ':checkpointId')` — расписание работы точки обслуживания.
- `Nav.checkpoints(':shopId', ':lineId')` — точки обслуживания выбранной очереди.
- `Nav.checkpoints(':shopId')` — точки обслуживания выбранного места.

#### Мониторинг и расписание очереди — 11 тестов

- `Nav.lineMonitoringCreate(':placeId', ':lineId')` — создание позиции в расширенном мониторинге.
- `Nav.lineMonitoringEdit(':placeId', ':lineId', ':positionId')` — редактирование позиции в расширенном мониторинге.
- `Nav.basicLineMonitoringCreate(':placeId', ':lineId')` — создание позиции в базовом мониторинге.
- `Nav.basicLineMonitoringEdit(':placeId', ':lineId', ':positionId')` — редактирование позиции в базовом мониторинге.
- `Nav.basicLineMonitoringPosition(':shopId', ':lineId', ':positionId')` — просмотр позиции в базовом мониторинге.
- `Nav.basicLineMonitoring(':shopId', ':lineId')` — базовый мониторинг очереди.
- `Nav.lineMonitoring(':shopId', ':lineId')` — расширенный мониторинг очереди.
- `Nav.lineScheduler(':shopId', ':lineId')` — расписание очереди.
- `Nav.lineAppointmentScheduler(':shopId', ':lineId')` — расписание предварительных записей очереди.
- `Nav.lineMonitoringPosition(':shopId', ':lineId', ':positionId')` — просмотр позиции в расширенном мониторинге.
- `Nav.lineMonitoringState(':shopId', ':lineId')` — статистика состояния мониторинга.

#### Настройки очереди — 5 тестов

- `Nav.createLine(':shopId')` — создание очереди.
- `Nav.editLine(':shopId', ':lineId')` — редактирование подготовленной очереди.
- `Nav.lineServicesDependency(':shopId', ':lineId')` — зависимости услуг очереди.
- `Nav.line(':shopId', ':lineId')` — просмотр очереди.
- `Nav.lines(':shopId')` — список очередей места.

#### Места, выходные дни, экраны вызова и экспорт — 12 тестов

- `Nav.shopDaysOff(':shopId')` — выходные дни места.
- `Nav.createShopCallScreen(':shopId')` — создание экрана вызова.
- `Nav.editShopCallScreen(':shopId', ':callScreenId')` — редактирование подготовленного экрана вызова.
- `Nav.shopCallScreen(':shopId', ':callScreenId')` — просмотр экрана вызова.
- `Nav.shopCallScreens(':shopId')` — список экранов вызова места.
- `Nav.exportData(':shopId')` — экспорт данных выбранного места.
- `Nav.globalExportData()` — список глобальных экспортов.
- `Nav.globalExportDataCreate()` — создание глобального экспорта.
- `Nav.createShop()` — создание места.
- `Nav.editShop(':shopId')` — редактирование подготовленного места.
- `Nav.shop(':shopId')` — просмотр места.
- `Nav.shops()` — список мест.

#### Переводы и теги — 6 тестов

- `Nav.createTranslation()` — создание перевода.
- `Nav.editTranslation(':translationId')` — редактирование подготовленного перевода.
- `Nav.translations()` — список переводов.
- `Nav.tags()` — список тегов.
- `Nav.createTag()` — создание тега.
- `Nav.editTag(':tagId')` — редактирование подготовленного тега.

### 1.2. Smoke-тесты прав доступа

Источник: `specs/permissions/permissions-smoke.spec.ts`.

Каждая строка ниже соответствует двум тестам:

1. `permissions allowed route <name>` — пользователь с нужным правом открывает маршрут или видит разрешённое действие.
2. `permissions denied route <name>` — пользователь без права перенаправляется с маршрута либо не видит защищённое действие.

Итого: **23 проверки × 2 пользователя = 46 тестов**.

#### Дополнительные настройки места — 3 проверки / 6 тестов

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `beacons/list` | `accessBeacons` | `full` | `noAccess` | Доступ к списку маяков места. |
| `days-off/list` | `accessDaysOff` | `full` | `noAccess` | Доступ к выходным дням места. |
| `availabilities/list` | `accessAvailabilities` | `full` | `noAccess` | Доступ к управлению доступностью персонала. |

#### Бренды, кампании, сообщения и данные — 6 проверок / 12 тестов

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `brands/list` | `manageBrands` | `full` | `restricted` | Доступ к списку брендов. |
| `campaigns/list` | `manageCampaigns` | `full` | `restricted` | Доступ к списку кампаний. |
| `messages/list` | `manageMessagesTemplates` | `full` | `restricted` | Доступ к шаблонам сообщений. |
| `data-export/list` | `manageDataExport` | `full` | `restricted` | Доступ к экспорту данных места. |
| `global-data-export/list` | `manageGlobalDataExport` | `full` | `restricted` | Доступ к глобальному экспорту данных. |
| `translations/list` | `manageTranslations` | `full` | `restricted` | Доступ к списку переводов. |

#### Места и очереди — 5 проверок / 10 тестов

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `shop/add affordance` | `canAddAndDeleteShop` | `full` | `restricted` | Видимость кнопки создания места. |
| `shop/edit` | `canUpdateShop` | `full` | `restricted` | Доступ к редактированию места. |
| `line/add affordance` | `canAddAndDeleteLine` | `full` | `restricted` | Видимость кнопки создания очереди. |
| `line/edit` | `canUpdateLine` | `full` | `restricted` | Доступ к редактированию очереди. |
| `line/view` | `canViewLine` | `restricted` | `noAccess` | Доступ к просмотру очереди. |

#### Точки обслуживания и административные маршруты — 2 проверки / 4 теста

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `checkpoint/work-schedule` | `canChangeCheckpointWorkScheduleMode` | `full` | `restricted` | Доступ к расписанию точки обслуживания. |
| `brand-admin/routes` | `canPromoteToAdmin` | основной администратор стенда | `restricted` | Доступ к маршрутам администрирования бренда. |

#### Пользователи и терминалы — 2 проверки / 4 теста

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `users/list` | `canManageUserAccounts` | `manageUsers` | `restricted` | Доступ к списку пользователей. |
| `terminals/list` | `manageTerminals` | `full` | `restricted` | Доступ к списку терминалов. |

#### Записи, журналы и мониторинг — 5 проверок / 10 тестов

| Имя проверки | Право | Разрешённый пользователь | Запрещённый пользователь | Что проверяется |
| --- | --- | --- | --- | --- |
| `appointments/list` | `manageAppointments` | `full` | `restricted` | Доступ к списку предварительных записей. |
| `appointments/view` | `canViewAppointments` | `full` | `restricted` | Доступ к просмотру предварительной записи. |
| `appointments/edit` | `canEditAppointments` | `full` | `restricted` | Доступ к редактированию предварительной записи. |
| `journal/list` | `manageJournal` | `full` | `restricted` | Доступ к журналу. |
| `monitoring route` | `accessPlaceLineMonitoring` | `full` | `restricted` | Доступ к мониторингу очереди. |

## 2. Функциональные тесты административной панели

В группу входят **26 тестов в 7 spec-файлах**:

| Подгруппа | Spec-файл | Количество |
| --- | --- | ---: |
| Жизненный цикл позиций и записей в мониторинге | `specs/admin/line-monitoring.spec.ts` | 4 |
| Сохранение настроек | `specs/admin/settings.spec.ts` | 4 |
| Массовые действия с точками обслуживания | `specs/admin/checkpoint-list.spec.ts` | 1 |
| Точки обслуживания — кейсы Kiwi TCMS | `specs/admin/checkpoint-cases.spec.ts` | 9 |
| Графики сотрудников — кейсы Kiwi TCMS | `specs/admin/staff-management-cases.spec.ts` | 3 |
| Создание записи на сегодня — кейсы Kiwi TCMS | `specs/admin/appointment-today.spec.ts` | 3 |
| Создание предварительной записи — кейсы Kiwi TCMS | `specs/admin/future-appointment-creation.spec.ts` | 2 |
| **Всего** |  | **26** |

### 2.1. Жизненный цикл позиций и записей в мониторинге — 4 теста

Источник: `specs/admin/line-monitoring.spec.ts`.

- `line monitoring creates asap position and completes service` — создаёт позицию без выбора времени, проводит её через обслуживание и сохраняет данные для проверки журнала.
- `line monitoring creates timed today position and completes service` — создаёт позицию на выбранное время сегодня, завершает обслуживание и сохраняет данные для проверки журнала.
- `line monitoring creates tomorrow appointment and removes it from appointments list` — создаёт запись на завтра через мониторинг, находит её в списке записей и удаляет.
- `position journal shows completed line monitoring positions with details` — проверяет в журнале деталей завершённых `asap`- и `timed`-позиций, созданных предыдущими тестами.

Набор выполняется последовательно, потому что проверка журнала использует результаты предыдущих сценариев.

### 2.2. Сохранение настроек — 4 теста

Источник: `specs/admin/settings.spec.ts`.

- `terminal settings enable final screen for future appointment` — включает финальный экран терминала, создаёт будущую запись, проверяет экран успеха, удаляет запись и возвращает исходную настройку терминала.
- `line settings persist name after reopen` — изменяет название очереди, повторно открывает её, проверяет сохранение и восстанавливает исходное значение.
- `checkpoint settings persist description after reopen` — изменяет описание точки обслуживания, проверяет его после повторного открытия и восстанавливает исходное значение.
- `shop settings keep Ekaterinburg timezone and persist description after reopen` — проверяет часовой пояс Екатеринбурга, изменяет описание места, повторно проверяет описание и часовой пояс, затем восстанавливает исходное описание.

### 2.3. Массовые действия с точками обслуживания — 1 тест

Источник: `specs/admin/checkpoint-list.spec.ts`.

- `disables all service points in a line` — автоматизация Kiwi TC-40: включает три точки одной очереди, нажимает «Выключить все точки», подтверждает выключение и проверяет в интерфейсе и API, что все три точки выключены.

### 2.4. Точки обслуживания — кейсы Kiwi TCMS — 9 тестов

Источник: `specs/admin/checkpoint-cases.spec.ts`.

- `TC-31 creates a service point` — создаёт точку обслуживания через интерфейс и проверяет её в списке и API.
- `TC-32 deletes a service point` — удаляет точку обслуживания через интерфейс с подтверждением и проверяет её отсутствие.
- `TC-33 edits a service point` — изменяет название и описание точки обслуживания и проверяет сохранённые значения.
- `TC-34 starts a service point with supported work modes` — проверяет запуск круглосуточно, в установленные часы и в часы работы очереди.
- `TC-35 edits settings while a service point is active` — изменяет режим расписания работающей точки с обязательным комментарием.
- `TC-36 stops an active service point with a reason` — завершает работу точки с указанием причины и проверяет итоговый статус.
- `TC-39 starts a service point before its scheduled opening` — запускает точку до начала заданных часов и проверяет её автоматический переход к работе.
- `TC-53 completes the full position service cycle at a service point` — создаёт ASAP-позицию и выполняет цикл «Готов к обслуживанию» → «Вызвать» → «Начать обслуживание» → «Закончить обслуживание» → «Подтвердить».
- `TC-73 starts a hidden service point without adding booking capacity` — запускает скрытую точку и через мониторинг проверяет отсутствие слотов на сегодня; затем параллельно запускает обычную точку, проверяет появление слотов, создаёт позицию на выбранное время и полностью обслуживает её на скрытой точке.

### 2.5. Графики сотрудников — кейсы Kiwi TCMS — 3 теста

Источник: `specs/admin/staff-management-cases.spec.ts`.

- `TC-41 creates an employee schedule` — создаёт график сотрудников на будущую дату, выбирает услугу, количество точек, рабочее время и перерыв; проверяет запись в интерфейсе и API, а также наличие тайм-слотов в рабочем интервале и их отсутствие во время перерыва.
- `TC-48 edits an employee schedule` — изменяет дату, выбранную услугу, количество точек, рабочее время и перерыв существующего графика; проверяет сохранённые параметры и отображение тайм-слотов по новым границам рабочего времени и перерыва.
- `TC-49 deletes an employee schedule` — перед удалением проверяет созданные графиком тайм-слоты, затем удаляет график с подтверждением и убеждается, что запись отсутствует в API, а тайм-слоты больше недоступны для записи.

### 2.6. Создание записи на сегодня — кейсы Kiwi TCMS — 3 теста

Источник: `specs/admin/appointment-today.spec.ts`.

- `TC-1 creates a timed appointment for today from line monitoring` — создаёт запись на выбранный тайм-слот сегодня из мониторинга очереди; в API и карточке позиции проверяет услугу, время и персональные данные, затем удаляет позицию.
- `TC-5 creates a timed technical service break for today from line monitoring` — включает режим технического перерыва, выбирает сотрудника, техническую услугу, точку обслуживания и время; проверяет в API тип `Break`, сотрудника, услугу и точку, проверяет карточку в мониторинге и удаляет позицию.
- `TC-14 creates an appointment for today from the appointments journal` — открывает создание из раздела «Бронирования», выбирает слот на сегодня и вводит персональные данные; текущая реализация сразу переводит такую запись в активную позицию со статусом API `joined`, поэтому тест проверяет её в мониторинге и UI-статус «В очереди», затем удаляет позицию.

### 2.7. Создание предварительной записи — кейсы Kiwi TCMS — 2 теста

Источник: `specs/admin/future-appointment-creation.spec.ts`.

- `TC-7 creates a future appointment from the position journal` — открывает `/#/position-journal`, создаёт запись на завтра через форму журнала: выбирает очередь, услугу, место, дату и тайм-слот, вводит персональные данные; проверяет введённые данные на итоговом экране журнала и экран успешного создания, затем контролирует созданную запись через API списка и удаляет её.
- `TC-10 creates a future appointment from the appointment scheduler` — открывает форму из планировщика бронирований, создаёт запись на завтра и проверяет её в API списка, а также отображение клиента и услуги в карточке планировщика; затем удаляет запись.

## 3. Функциональные тесты прав доступа

Источник: `specs/permissions/permissions-feature.spec.ts`.

### 3.1. Рабочее место оператора

- `checkpoint feature permissions expose full host controls` — пользователь `full` видит запуск точки, скрытый запуск, изменение режима расписания и выбор всех услуг.
- `checkpoint feature permissions show read-only host controls without rights` — пользователь `restricted` видит только разрешённый запуск; скрытый запуск, расписание и выбор всех услуг недоступны.

### 3.2. Сокращённый интерфейс

- `displayReducedInterface hides checkpoint bulk close action` — у пользователя `full` отображается кнопка «Выключить все точки», а у пользователя `reduced` она скрыта.

## 4. Функциональные тесты терминала

Источник: `specs/terminal/booking.spec.ts`.

### 4.1. Постановка в очередь

- `timed today creates booking and removes it from monitoring` — выбирает время на сегодня, подтверждает постановку, проверяет успешный `joinLine` и удаляет созданную позицию из мониторинга.
- `asap creates live queue position and removes it from monitoring` — создаёт позицию в живой очереди без выбора времени, проверяет идентификатор позиции и удаляет её из мониторинга.

### 4.2. Будущие предварительные записи

- `future appointment with final screen shows success and removes it from appointments list` — создаёт будущую запись на терминале с включённым финальным экраном, проверяет экран успеха и удаляет запись.
- `future appointment without final screen returns to intro and removes it from appointments list` — создаёт будущую запись без финального экрана, проверяет возврат на стартовый экран и удаляет запись.

### 4.3. Недоступные состояния

- `no slots shows unavailable time screen` — при отсутствии свободных интервалов отображается экран недоступного времени.
- `stopped checkpoint shows unavailable screen` — при остановленной точке обслуживания терминал показывает недоступность.
- `disabled terminal shows closed terminal screen` — выключенный терминал показывает экран закрытого терминала.

## 5. Запуск групп

Полный цикл с созданием стенда, всеми тестами и очисткой:

```bash
pnpm full:cycle
```

Административные и терминальные тесты на уже подготовленном стенде:

```bash
pnpm test
```

Только smoke-тесты административных маршрутов:

```bash
pnpm exec playwright test specs/admin/coverage-smoke.spec.ts
```

Только функциональные тесты административной панели:

```bash
pnpm exec playwright test specs/admin/appointment-today.spec.ts specs/admin/future-appointment-creation.spec.ts specs/admin/line-monitoring.spec.ts specs/admin/settings.spec.ts specs/admin/checkpoint-list.spec.ts specs/admin/checkpoint-cases.spec.ts specs/admin/staff-management-cases.spec.ts
```

Только кейсы Kiwi TCMS по созданию записи на сегодня:

```bash
pnpm exec playwright test specs/admin/appointment-today.spec.ts
```

Только кейсы Kiwi TCMS по созданию предварительной записи:

```bash
pnpm exec playwright test specs/admin/future-appointment-creation.spec.ts
```

Только кейсы Kiwi TCMS для точек обслуживания:

```bash
pnpm exec playwright test specs/admin/checkpoint-cases.spec.ts
```

Полный цикл permission-тестов с подготовкой и очисткой:

```bash
pnpm permissions:cycle
```

Только permission smoke на уже подготовленном permission-стенде:

```bash
pnpm exec playwright test specs/permissions/permissions-smoke.spec.ts
```

Только функциональные permission-тесты:

```bash
pnpm exec playwright test specs/permissions/permissions-feature.spec.ts
```

Только тесты терминала:

```bash
pnpm exec playwright test specs/terminal/booking.spec.ts
```
