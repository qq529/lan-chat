@echo off
chcp 65001 >nul
echo ================================
echo   LAN Chat - 打包 Server.exe
echo ================================
echo.

REM 安装依赖（含 pkg）
echo [1/3] 安装依赖...
call npm install --include=dev
if %errorlevel% neq 0 (
    echo npm install 失败
    pause
    exit /b
)

REM 创建 dist 目录
if not exist dist mkdir dist

REM 打包
echo [2/3] 打包 Server.exe...
call npx pkg server.js --output dist/Server.exe --assets node_modules/sql.js/dist/sql-wasm.wasm
if %errorlevel% neq 0 (
    echo pkg 打包失败
    pause
    exit /b
)

REM 复制 public 目录到 dist 目录（Server.exe 运行时需要）
echo [3/3] 复制前端文件...
if exist dist\public rmdir /s /q dist\public
xcopy /e /i /q public dist\public >nul

echo.
echo ================================
echo   打包完成！
echo   输出文件: dist\Server.exe
echo   使用方式: 直接运行 Server.exe
echo   然后浏览器访问 http://本机IP:3000
echo ================================
echo.
pause
