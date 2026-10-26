@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist ".env" (
  echo [提示] 未找到 .env 配置文件：可复制 .env.example 为 .env 并填入 XFYUN_API_KEY / XFYUN_MODEL
  echo        配好后无需进后台添加配置即可直接对话；也可继续用后台管理维护多配置。
)
echo ============================================
echo   星火 MaaS 文本对话工作台
echo   工作台:    http://127.0.0.1:4000/
echo   后台管理:  http://127.0.0.1:4000/admin （需密码，初始密码见下方日志）
echo   忘记密码:  双击「重置密码.bat」可重置 owner 密码
echo ============================================
node server.js
pause
