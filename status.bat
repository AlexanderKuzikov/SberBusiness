@echo off
chcp 65001 >nul
echo === Статус SberAuto ===
echo.
if exist logs\status.json (
    type logs\status.json
) else (
    echo Статус ещё не создан. Запустите скрипт хотя бы раз.
)
echo.
echo === Последние 10 строк лога ===
powershell -NoProfile -Command "Get-Content -Tail 10 'logs\sber.log'"
echo.
pause