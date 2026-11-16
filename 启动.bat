@echo off
rem ============================================================
rem  UTF-8 self-relaunch guard (keep this zone pure ASCII!).
rem  Known cmd.exe bug: switching codepage (chcp 65001) mid-file
rem  makes the parser re-read remaining lines from a stale byte
rem  offset, so multi-byte UTF-8 lines get truncated/misparsed.
rem  Workaround: relaunch this script in a child cmd AFTER the
rem  codepage switch, so the whole file is re-read from byte 0
rem  already under UTF-8. File MUST be saved as CRLF (cmd.exe
rem  mis-parses LF-only batch files).
rem ============================================================
if "%~1"=="__utf8__" goto main
>nul 2>nul chcp 65001
cmd /d /c call "%~f0" __utf8__ %*
exit /b %errorlevel%

:main
setlocal EnableExtensions
cd /d "%~dp0"
title 星火 MaaS 文本对话工作台 · 管理菜单
set /a EMPTY=0
rem 自重启标记 __utf8__ 占用了 %1，shift 掉它，让 %~1 恢复为用户真实输入的第一个参数
shift

rem —— 命令行参数模式（也可脚本化调用）：start | stop | port <n> | reset ——
if /i "%~1"=="start" (set "MENU=" & goto do_start)
if /i "%~1"=="stop" (set "MENU=" & goto do_stop)
if /i "%~1"=="port" (set "MENU=" & set "NEWPORT=%~2" & goto do_port)
if /i "%~1"=="reset" (set "MENU=" & goto do_reset)
if not "%~1"=="" (
  echo 用法: 启动.bat [start^|stop^|port 端口号^|reset]
  echo       不带参数则进入交互菜单。
  exit /b 1
)
set "MENU=1"

:menu
call :read_port
cls
echo ============================================
echo   星火 MaaS 文本对话工作台 · 管理菜单
echo ============================================
echo   当前端口: %CURPORT%  （读取 .env 中 PORT=，默认 4000）
echo.
echo   [1] 启动服务
echo   [2] 停止服务
echo   [3] 修改端口
echo   [4] 重置密码
echo   [0] 退出
echo ============================================
echo   提示: [3] 会把端口写入 .env 持久生效；
echo         API Key 等配置可复制 .env.example 为 .env。
echo.
set "CHOICE="
set /p "CHOICE=请输入编号后回车: "
if defined CHOICE for /f "tokens=* delims= " %%c in ("%CHOICE%") do set "CHOICE=%%c"
if not defined CHOICE set /a EMPTY+=1
if %EMPTY% GEQ 3 exit /b 0
if not defined CHOICE goto menu
if "%CHOICE%"=="1" goto do_start
if "%CHOICE%"=="2" goto do_stop
if "%CHOICE%"=="3" goto do_port
if "%CHOICE%"=="4" goto do_reset
if "%CHOICE%"=="0" exit /b 0
goto menu

rem ============ [1] 启动服务 ============
:do_start
call :preflight
if errorlevel 1 goto done
call :read_port
echo.
echo ============================================
echo   星火 MaaS 文本对话工作台
echo   工作台:    http://127.0.0.1:%CURPORT%/
echo   后台管理:  http://127.0.0.1:%CURPORT%/admin （需密码，初始密码见下方日志）
echo   停止服务:  本窗口按 Ctrl+C，或另开窗口运行本脚本选 [2]
echo ============================================
echo.
node server.js
set "RC=%errorlevel%"
echo.
echo [提示] 服务已退出（退出码 %RC%）。若提示端口被占用，
echo        先用菜单 [2] 停止旧实例，或用 [3] 更换端口。
goto done

rem ============ [2] 停止服务 ============
:do_stop
call :read_port
echo.
echo 正在检查端口 %CURPORT% 上的服务进程...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns=Get-NetTCPConnection -LocalPort %CURPORT% -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host '  [提示] 端口 %CURPORT% 无监听进程，服务未在运行。'; exit 0 }; $ids=@($conns | Select-Object -ExpandProperty OwningProcess -Unique); $killed=0; foreach ($procId in $ids) { $proc=Get-CimInstance Win32_Process -Filter \"ProcessId=$procId\" -ErrorAction SilentlyContinue; if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.js') { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host \"  [成功] 已停止服务进程 (PID $procId)\"; $killed++ } else { Write-Host \"  [跳过] PID $procId 不是本工作台的服务进程，未动它\" } }; if ($killed -eq 0) { Write-Host '  [提示] 该端口上没有本工作台的服务进程。' }"
set "RC=0"
goto done

rem ============ [3] 修改端口 ============
:do_port
call :read_port
if not defined MENU goto port_check
echo.
echo 当前端口: %CURPORT%
set "NEWPORT="
set /p "NEWPORT=请输入新的端口 (1-65535，直接回车取消): "
if not defined NEWPORT goto done

:port_check
if not defined NEWPORT (
  echo [错误] 用法: 启动.bat port ^<端口号^>
  set "RC=1"
  goto done
)
for /f "tokens=* delims= " %%c in ("%NEWPORT%") do set "NEWPORT=%%c"
if not "%NEWPORT:~5,1%"=="" (
  echo [错误] 端口最长 5 位数字。
  set "RC=1"
  goto done
)
echo(%NEWPORT%| findstr /r /c:"^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo [错误] 端口必须是纯数字。
  set "RC=1"
  goto done
)
if %NEWPORT% LSS 1 (
  echo [错误] 端口不能小于 1。
  set "RC=1"
  goto done
)
if %NEWPORT% GTR 65535 (
  echo [错误] 端口不能大于 65535。
  set "RC=1"
  goto done
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='PORT=%NEWPORT%'; $enc=New-Object System.Text.UTF8Encoding($false); $f=Join-Path (Get-Location) '.env'; if (Test-Path -LiteralPath $f) { $c=@(Get-Content -LiteralPath $f -Encoding UTF8); if (@($c | Where-Object { $_ -match '^\s*PORT\s*=' }).Count -gt 0) { $c=@($c | ForEach-Object { if ($_ -match '^\s*PORT\s*=') { $p } else { $_ } }) } else { $c+=$p }; [IO.File]::WriteAllLines($f,$c,$enc) } else { [IO.File]::WriteAllLines($f,@($p),$enc) }"
echo [成功] 端口已改为 %NEWPORT%（写入 .env），下次「启动服务」生效。
echo        若服务正在运行，请先用 [2] 停止再 [1] 启动。
set "RC=0"
goto done

rem ============ [4] 重置密码 ============
:do_reset
call :preflight
if errorlevel 1 goto done
echo.
echo 正在启动密码重置工具（默认把 owner 重置为随机临时密码）...
echo 说明: 服务运行中时工具会拒绝执行——先在菜单 [2] 停止服务再回来。
echo       高级用法: node scripts\reset-password.js ^<账号^> --password 新密码
echo.
node scripts\reset-password.js
set "RC=%errorlevel%"
echo.
goto done

rem ============ 动作收尾：菜单模式回菜单，参数模式退出 ============
:done
if defined MENU (
  pause
  goto menu
)
exit /b %RC%

rem ============ 子过程：读取 .env 中的端口 ============
:read_port
set "CURPORT=4000"
if not exist ".env" exit /b 0
for /f "tokens=1,* delims== " %%a in ('findstr /i /b /l "port=" ".env"') do (
  if /i "%%a"=="PORT" for /f "tokens=* delims= " %%c in ("%%~b") do set "CURPORT=%%c"
)
exit /b 0

rem ============ 子过程：Node 与依赖自检 ============
:preflight
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，本项目需要 Node.js 18 及以上版本。
  echo        请先到 https://nodejs.org/ 下载安装 LTS 版本后重试。
  exit /b 1
)
if exist "node_modules\express" exit /b 0
echo [提示] 首次运行：正在安装依赖（npm install），视网络情况约需 1-2 分钟，请勿关闭窗口...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [错误] 依赖安装失败：请检查网络后重试，或手动执行 npm install 后再试。
  exit /b 1
)
echo [提示] 依赖安装完成。
exit /b 0
