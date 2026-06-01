@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ===================================
echo  Установка SberAuto
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
echo [1/4] Установка зависимостей (npm ci)...
if exist package-lock.json (
    call npm ci
) else (
    call npm install
)
if %errorlevel% neq 0 (
    echo ОШИБКА: npm install упал
    pause
    exit /b 1
)

:: Проверка audit
echo.
echo [2/4] Проверка безопасности (npm audit)...
call npm audit
if %errorlevel% neq 0 (
    echo.
    echo ВНИМАНИЕ: Обнаружены уязвимости в зависимостях.
    set /p cont=Продолжить установку? (Y/N): 
    if /i not "!cont!"=="Y" exit /b 1
)

:: Создание .env
echo.
if not exist .env (
    echo [3/4] Создание .env...
    (
        echo # Почта ^(пароль приложения, не основной!^)
        echo IMAP_HOST=imap.gmail.com
        echo IMAP_PORT=993
        echo IMAP_USER=your_email@gmail.com
        echo IMAP_PASS=your_app_password
        echo.
        echo # Куда сохранять
        echo DOWNLOAD_DIR=C:\SberStatements
        echo.
        echo # Расписание
        echo SUCCESS_TIME=10:00
        echo RETRY_HOURS=3
    ) > .env
    echo.
    echo ВАЖНО: Отредактируйте .env и укажите свои данные!
    notepad .env
) else (
    echo [3/4] .env уже существует, пропускаем
)

:: Добавление в автозагрузку
echo.
echo [4/4] Добавление в автозагрузку...
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Создание ярлыка в папке автозагрузки
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\SberAuto.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'node'; $s.Arguments = '--env-file=\"\"%SCRIPT_DIR%\.env\"\" \"%SCRIPT_DIR%\index.js\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

if %errorlevel% equ 0 (
    echo.
    echo ===================================
    echo  Установка завершена!
    echo ===================================
    echo.
    echo Автозагрузка: %STARTUP%
    echo Логи: %SCRIPT_DIR%\logs\sber.log
    echo Файлы: %DOWNLOAD_DIR%
    echo.
    echo SberAuto появится в трее при следующем входе в систему.
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