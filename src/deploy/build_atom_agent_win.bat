rem @echo off
cls
REM  default - clean build
set CLEAN=true

REM Read input parameters in the form of "CLEAN:false"

FOR %%A IN (%*) DO (
   FOR /f "tokens=1,2 delims=:" %%G IN ("%%A") DO set %%G=%%H
)


echo "CLEAN BUILD ==>"%CLEAN%
IF %CLEAN%==false GOTO SKIP_BUILD
call npm cache clean
echo "delete old files"
rd /s/q build\windows
mkdir build\windows
cd build\windows
mkdir .\ssl\
echo "copy files"
copy ..\..\images\noobaa_icon24.ico .
copy ..\..\src\deploy\7za.exe .
copy ..\..\src\deploy\openssl.cnf  .\ssl\
copy ..\..\src\deploy\wget.exe  .
copy ..\..\src\deploy\NooBaa_Agent_wd.exe .
copy ..\..\package.json .
copy ..\..\config.js .
mkdir .\src\
xcopy /Y/I/E ..\..\src\agent .\src\agent
xcopy /Y/I/E ..\..\src\util .\src\util
xcopy /Y/I/E ..\..\src\rpc .\src\rpc
xcopy /Y/I/E ..\..\src\api .\src\api
REM remove irrelevant packages
type package.json  | findstr /v forever-service | findstr /v jsonwebtoken | findstr /v forever | findstr /v googleapis | findstr /v gulp | findstr /v bower | findstr /v bootstrap | findstr /v browserify | findstr /v rebuild | findstr /v nodetime| findstr /v newrelic > package.json_s
del /Q package.json
rename package.json_s package.json
call npm install -dd
xcopy /Y/I/E ..\..\build\Release .\Release
del /Q node.exe
del /Q openssl.exe
del /Q *.dll
del /Q ..\public\*.dll
del /Q ..\public\node.exe
del /Q ..\public\openssl.exe
call curl -L https://nodejs.org/dist/v4.2.1/win-x86/node.exe > node.exe
call curl -L https://indy.fulgan.com/SSL/openssl-1.0.2d-i386-win32.zip > openssl.zip
call 7za.exe e openssl.zip -y -x!*.txt
del /Q openssl.zip
copy /y *.dll ..\public\
copy /y node.exe ..\public\node.exe
copy /y openssl.exe ..\public\openssl.exe
cd ..\..
echo "done building"

:SKIP_BUILD

cd build\windows

echo "building installer"

makensis -NOCD ..\..\src\deploy\atom_agent_win.nsi

"c:\Program Files\Microsoft SDKs\Windows\v7.1\Bin\signtool"  sign /t http://timestamp.digicert.com /a noobaa-setup.exe

echo "noobaa-setup.exe installer available under build\windows"

cd ..\..

pause

exit 0
