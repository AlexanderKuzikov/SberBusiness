@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ===================================
echo  Установка SberBusiness
echo ===================================
echo.

:: Проверка прав администратора
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ОШИБКА: Запустите от имени администратора!
    pause
    exit /b 1
)

:: Проверка Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ОШИБКА: Node.js не найден в PATH!
    pause
    exit /b 1
)

:: Проверка версии Node.js
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo Обнаружен Node.js %NODE_VER%

:: Установка зависимостей
echo.
echo [1/5] Установка зависимостей (npm ci)...
call npm ci
if %errorlevel% neq 0 (
    echo ОШИБКА: npm ci упал
    pause
    exit /b 1
)

:: Проверки
echo.
echo [2/5] Статическая проверка (npm run check)...
call npm run check
if %errorlevel% neq 0 (
    echo ОШИБКА: npm run check упал
    pause
    exit /b 1
)

echo.
echo [3/5] Тесты (npm test)...
call npm test
if %errorlevel% neq 0 (
    echo ОШИБКА: npm test упал
    pause
    exit /b 1
)

:: Проверка audit
echo.
echo [4/5] Проверка безопасности (npm audit --omit=dev --audit-level=moderate)...
call npm audit --omit=dev --audit-level=moderate
if %errorlevel% neq 0 (
    echo ОШИБКА: Обнаружены уязвимости уровня moderate или выше.
    pause
    exit /b 1
)

:: Создание .env
echo.
if not exist .env (
    echo [5/5] Создание .env из .env.example...
    copy .env.example .env >nul
    echo.
    echo ВАЖНО: Отредактируйте .env и укажите свои данные!
    notepad .env
) else (
    echo [5/5] .env уже существует, пропускаем
)

:: Добавление в автозагрузку
echo.
echo Добавление в автозагрузку...
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Создание ярлыка в папке автозагрузки
set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
set "SHORTCUT=%STARTUP%\\SberBusiness.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'node'; $s.Arguments = '--env-file=\\\"\\\"%SCRIPT_DIR%\\.env\\\"\\\" \\\"%SCRIPT_DIR%\\index.js\\\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

if %errorlevel% equ 0 (
    echo.
    echo ===================================
    echo  Установка завершена!
    echo ===================================
    echo.
    echo Автозагрузка: %STARTUP%
    echo Логи: %SCRIPT_DIR%\\logs\\sber.log
    echo Конфиг: %SCRIPT_DIR%\\config.json
    echo.
    echo SberBusiness появится в трее при следующем входе в систему.
    echo Запустить сейчас? (Y/N)
    set /p run_now=
    if /i "!run_now!"=="Y" (
        echo Запуск...
        start /b node --env-file="%SCRIPT_DIR%\.env" "%SCRIPT_DIR%\index.js"
    )
) else (
    echo ОШИБКА: Не удалось создать ярлык в автозагрузке.
)

echo.
pause