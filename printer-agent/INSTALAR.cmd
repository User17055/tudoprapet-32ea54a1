@echo off
title Instalador TudoPraPet Impressao
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar. Envie uma foto desta tela ao suporte.
  pause
) else (
  echo.
  echo Instalacao concluida. Esta janela pode ser fechada.
  timeout /t 8
)
