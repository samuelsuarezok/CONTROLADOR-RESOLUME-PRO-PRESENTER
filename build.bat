@echo off
chcp 65001 >nul
REM Genera los ejecutables en la carpeta dist\  (requiere tener Bun instalado SOLO para compilar)
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun no esta instalado. Descargalo de https://bun.sh y volve a ejecutar este archivo.
  pause
  exit /b 1
)
call bun install
call bun run build
pause
