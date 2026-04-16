# Backend

Django REST API с JWT-аутентификацией.

## Запуск

```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

## Переменные окружения

Создайте `backend/.env` по примеру `backend/.env.example`.

## Tilda → backend: заказ и оплата (`POST /users/api/orders/`)

Эндпоинт принимает плоский JSON или form-data (как шлёт Tilda). Аутентификация: заголовок
`X-Order-Webhook-Secret` или `Authorization: Bearer <ORDER_WEBHOOK_SHARED_SECRET>`.

### Обязательные поля

Строго обязательных имён нет: достаточно ненулевого набора ключей. Пустое тело → `400`.

### Сильно рекомендуется (стабильный upsert / дедуп)

Один из идентификаторов заказа или транзакции (первое непустое значение по списку в коде):

`tranid`, `transaction_id`, `transact`, `orderid`, `invoiceid`, `paymentid` (см. варианты регистра в `referrals.services.extract_tilda_order_fields`).

- **Дедуп**: при наличии id — ключ `tilda:<external_id>`. Без id — `fp:<sha256>` по всему плоскому payload (любое изменение поля = новая строка заказа).

### Опционально

- Покупатель: `email` и типовые алиасы (`Email`, `form_email`, …).
- Сумма: `sum`, `amount`, `price`, `subtotal`, … → `Order.amount`; иначе `0.00`.
- Валюта: `currency` / `Currency`.
- **Реферальный код**: `ref`, `partner_ref`, `referral`, `ReferralCode` — должен совпасть с тем, что пользователь получил по ссылке `/?ref=...` (часто дублируют скрытым полем формы Tilda с тем же именем).

### Оплачен vs ожидает оплаты

Статус заказа и начисление комиссии зависят от полей вроде `paymentstatus`, `paid`, `is_paid`, `st` и запасного флага `payment` / `Payed`. Явные «не оплачен» (pending, unpaid, failed, …) **перекрывают** «оплаченный» вид `payment=1`. Подробные токены — в `referrals.services` (`_TILDA_UNPAID_STATUS`, `_TILDA_PAID_STATUS`, `_interpret_tilda_is_paid`).

### Логи приёма

При отсутствии внешнего id или неизвестном тексте статуса оплаты пишутся предупреждения в логгер `referrals.services` (без email, сумм и полного тела). Доп. диагностика по именам полей — `ORDER_WEBHOOK_DEBUG_LOGGING=True` в `.env`.
