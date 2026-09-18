@echo off
setlocal ENABLEEXTENSIONS

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "NSISDIR=%SCRIPT_DIR%\windows"
set "MAKENSIS_EXE=%NSISDIR%\makensis.exe"

if not exist "%MAKENSIS_EXE%" (
    echo makensis.exe not found at: %MAKENSIS_EXE% 1>&2
    exit /b 1
)

"%MAKENSIS_EXE%" %*
exit /b %ERRORLEVEL%
