@echo off
title FITPLAN
cd /d "%~dp0"
echo Iniciando FITPLAN em http://localhost:8090
python -m uvicorn app:app --host 0.0.0.0 --port 8090
pause
