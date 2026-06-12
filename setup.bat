@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
if not defined USERPROFILE set "USERPROFILE=%HOMEDRIVE%%HOMEPATH%"
if not defined APPDATA set "APPDATA=%USERPROFILE%\AppData\Roaming"
cd /d "%~dp0"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "ENV_FILE=%SCRIPT_DIR%\.env"
set "INDEX_JS=%SCRIPT_DIR%\index.js"

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
    echo.
    echo ПРЕДУПРЕЖДЕНИЕ: npm audit нашёл замечания или не смог завершить проверку.
    echo Установка продолжена.
    echo Для деталей выполни отдельно: npm audit --omit=dev
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
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut($env:SHORTCUT); $Shortcut.TargetPath = 'node.exe'; $Shortcut.Arguments = ('--env-file=\"' + $env:ENV_FILE + '\" \"' + $env:INDEX_JS + '\"'); $Shortcut.WorkingDirectory = $env:SCRIPT_DIR; $Shortcut.WindowStyle = 7; $Shortcut.Save()"
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
    if defined USERPROFILE (
        set "DESKTOP=%USERPROFILE%\Desktop"
    ) else if defined HOMEDRIVE (
        set "DESKTOP=%HOMEDRIVE%%HOMEPATH%\Desktop"
    ) else (
        set "DESKTOP=%CD%"
    )
    if not exist "%DESKTOP%" mkdir "%DESKTOP%" >nul 2>nul
    if exist "%DESKTOP%" (
        echo.
        echo Создаю ярлык на рабочем столе...
        set "SHORTCUT=%DESKTOP%\SberBusiness.lnk"
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut($env:SHORTCUT); $Shortcut.TargetPath = 'node.exe'; $Shortcut.Arguments = ('--env-file=\"' + $env:ENV_FILE + '\" \"' + $env:INDEX_JS + '\"'); $Shortcut.WorkingDirectory = $env:SCRIPT_DIR; $Shortcut.WindowStyle = 7; $Shortcut.Save()"
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