@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

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

:: Опционально: добавление в автозагрузку
echo.
echo Добавить SberBusiness в автозагрузку Windows? (Y/N)
set /p add_startup=
if /i "!add_startup!"=="Y" (
    echo.
    echo Добавляю в автозагрузку...
    set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
    set "SHORTCUT=%STARTUP%\\SberBusiness.lnk"
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'node.exe'; $s.Arguments = '--env-file=\\\"%SCRIPT_DIR%\\.env\\\" \\\"%SCRIPT_DIR%\\index.js\\\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"
    if !errorlevel! equ 0 (
        echo Автозагрузка добавлена: %SHORTCUT%
    ) else (
        echo ОШИБКА: Не удалось добавить SberBusiness в автозагрузку.
    )
) else (
    echo Автозагрузка не изменена.
)

:: Опционально: создание ярлыка на рабочем столе
echo.
echo Создать ярлык SberBusiness на рабочем столе? (Y/N)
set /p create_shortcut=
if /i "!create_shortcut!"=="Y" (
    if exist "%USERPROFILE%\\Desktop" (
        echo.
        echo Создаю ярлык на рабочем столе...
        set "DESKTOP=%USERPROFILE%\\Desktop"
        set "SHORTCUT=%DESKTOP%\\SberBusiness.lnk"
        powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'node.exe'; $s.Arguments = '--env-file=\\\"%SCRIPT_DIR%\\.env\\\" \\\"%SCRIPT_DIR%\\index.js\\\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"
        if !errorlevel! equ 0 (
            echo Ярлык создан: %SHORTCUT%
        ) else (
            echo ОШИБКА: Не удалось создать ярлык на рабочем столе.
        )
    ) else (
        echo Папка рабочего стола не найдена. Ярлык не создан.
    )
) else (
    echo Ярлык на рабочем столе не создан.
)

echo.
pause