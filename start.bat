@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器 http://localhost:8000 ...
start "" "http://localhost:8000"
where node >nul 2>nul && (node serve.mjs 8000 & goto :eof)
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
echo.
echo 没有找到 Node.js 或 Python。请安装其中任意一个（推荐 https://nodejs.org ），然后重新双击本文件。
pause
