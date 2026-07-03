@echo off
chcp 65001 >nul
echo ================================
echo   LAN Chat - 打包 Client.exe
echo ================================
echo.

REM 进入 client 目录
cd /d "%~dp0client"

REM 安装依赖
echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo npm install 失败
    pause
    exit /b
)

REM 打包
echo [2/3] 打包 Client.exe...
call npx electron-builder --win portable
if %errorlevel% neq 0 (
    echo electron-builder 打包失败
    pause
    exit /b
)

echo.
echo ================================
echo   打包完成！
echo   查看输出目录: ..\dist\Client\
echo ================================
echo.
pause
