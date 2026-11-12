@echo off
rem Запуск программы из любой папки: Electron лежит рядом, в node_modules.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
