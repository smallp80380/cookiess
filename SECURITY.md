# Безопасность / Security

## Как сообщить об уязвимости

Не создавайте публичный issue. Используйте приватное сообщение GitHub: вкладка **Security → Report a vulnerability** в этом репозитории ([Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Опишите версию (`chrome://extensions` показывает `X.Y.Z.N`), браузер, шаги воспроизведения и ожидаемое поведение. Используйте только синтетические cookies — никогда не прикладывайте настоящие значения сессий.

Please report vulnerabilities privately via **Security → Report a vulnerability**. Do not open public issues and never include real cookie values.

## Что считается уязвимостью

- Чтение, изменение или удаление cookies за пределами текущего сайта, store или partition.
- Отправка cookies или адреса вкладки за пределы устройства, сохранение значений cookies в storage или логах.
- Выполнение содержимого cookie или импортируемого файла как кода (XSS в popup).
- Обход запроса разрешения на доступ к сайту.

## Поддерживаемые версии

Исправления выпускаются только для последней сборки `main` (релиз с отметкой Latest).
