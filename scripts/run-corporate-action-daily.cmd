@echo off
cd /d "C:\Users\user\desktop\ai-stock-lab"

echo. >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log"
echo ================================================== >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log"
echo START %DATE% %TIME% >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log"

"C:\Program Files\nodejs\node.exe" .\scripts\corporate-action-daily.cjs >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log" 2>&1

set "RC=%ERRORLEVEL%"

echo EXIT_CODE %RC% >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log"
echo END %DATE% %TIME% >> "C:\Users\user\desktop\ai-stock-lab\logs\corporate-action-runtime\daily-task.log"

exit /b %RC%