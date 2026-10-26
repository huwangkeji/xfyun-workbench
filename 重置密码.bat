@echo off
chcp 65001 >nul
cd /d %~dp0
rem ============================================================
rem  Password reset tool (forgot password self-service)
rem  Double-click: reset owner account to a random temp password.
rem  Custom:  reset-password.bat zhangsan --password MyPass123
rem  Details: see comments in scripts/reset-password.js
rem ============================================================
node scripts\reset-password.js %*
pause
