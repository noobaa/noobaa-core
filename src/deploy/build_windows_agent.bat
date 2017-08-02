rem @echo off
cls
REM  default - clean build
set CLEAN=true
set GIT_COMMIT=DEVONLY

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
copy ..\..\frontend\src\assets\noobaa_icon24.ico .
copy ..\..\src\deploy\7za.exe .
copy ..\..\src\deploy\openssl.cnf  .\ssl\
copy ..\..\src\deploy\wget.exe  .
copy ..\..\src\deploy\NooBaa_Agent_wd.exe .
copy ..\..\package.json .
copy ..\..\config.js .
mkdir .\src\
xcopy /Y/I/E ..\..\src\agent .\src\agent
xcopy /Y/I/E ..\..\src\s3 .\src\s3
xcopy /Y/I/E ..\..\src\endpoint .\src\endpoint
xcopy /Y/I/E ..\..\src\util .\src\util
xcopy /Y/I/E ..\..\src\rpc .\src\rpc
xcopy /Y/I/E ..\..\src\api .\src\api
xcopy /Y/I/E ..\..\src\native .\src\native


rem set version with GIT commit information. push it to package.json.

set PATH=%PATH%;"C:\Program Files\Git\usr\bin\"

findstr version package.json>version.txt
set /P current_version_line=<version.txt
findstr version package.json|awk '{print $2}'|awk -F'"' '{print $2 >"version.txt"}'
set /P current_package_version=<version.txt

set GIT_COMMIT=%GIT_COMMIT:~0,7%
echo %current_version_line%
echo %current_package_version%
del version.txt
sed -i 's/%current_version_line%/\"version\": \"%current_package_version%-%GIT_COMMIT%\",/' package.json


REM
REM remove irrelevant packages
type package.json  | findstr /v npm-run-all | findstr /v forever-service | findstr /v istanbul | findstr /v mongoose | findstr /v selectize | findstr /v jsonwebtoken | findstr /v forever | findstr /v eslint | findstr /v googleapis | findstr /v gulp | findstr /v bower | findstr /v bootstrap | findstr /v browserify | findstr /v rebuild | findstr /v eslint| findstr /v nodetime| findstr /v newrelic| findstr /v vsphere > package.json_s

del /Q package.json
rename package.json_s package.json
copy ..\..\binding.gyp .

REM need to have a frontend dir with empty package.json for npm install to work
mkdir frontend
cd frontend
call npm init --force
cd ..

nvm install 6.11.2 32
nvm use 6.11.2 32
call nvm list

rem fail build if failed to install and build
call npm install --production || exit 1
if not exist ".\build\Release" exit 1

xcopy /Y/I/E .\build\Release .\build\Release-32

del /q/s .\build\Release
nvm install 6.11.2 64
nvm use 6.11.2 64
nvm list

call .\node_modules\.bin\node-gyp --arch=x64 configure
call .\node_modules\.bin\node-gyp --arch=x64 build
rd /q/s .\node_modules\node-gyp

xcopy /Y/I/E .\build\Release .\build\Release-64

call curl -L https://nodejs.org/dist/v6.11.2/win-x86/node.exe > node-32.exe
call curl -L https://nodejs.org/dist/v6.11.2/win-x64/node.exe > node-64.exe
call curl -L https://indy.fulgan.com/SSL/openssl-1.0.2l-i386-win32.zip > openssl_32.zip
call curl -L https://indy.fulgan.com/SSL/openssl-1.0.2l-x64_86-win64.zip > openssl_64.zip

mkdir .\32
mkdir .\64

rd /q/s .\build\Release
rd /q/s .\build\src
rd /q/s .\build\Windows
del /q .\build\*.*

call 7za.exe e openssl_32.zip -y -x!*.txt
del /Q openssl_32.zip

copy /y *.dll .\32\
copy /y node-32.exe .\32\node.exe
copy /y openssl.exe .\32\openssl.exe

del /Q *.dll
del /Q node-32.exe
del /Q openssl.exe

call 7za.exe e openssl_64.zip -y -x!*.txt
del /Q openssl_64.zip

copy /y *.dll .\64\
copy /y node-64.exe .\64\node.exe
copy /y openssl.exe .\64\openssl.exe

del /Q *.dll
del /Q node-64.exe
del /Q openssl.exe

del /s *.pdb

cd ..\..
echo "done building"

:SKIP_BUILD

cd build\windows

echo "building installer"

makensis -NOCD ..\..\src\deploy\atom_agent_win.nsi || exit 1

rename noobaa-setup.exe noobaa-setup-%current_package_version%-%GIT_COMMIT%.exe

IF EXIST "c:\Program Files\Microsoft SDKs\Windows\v7.1\Bin\signtool" (
"c:\Program Files\Microsoft SDKs\Windows\v7.1\Bin\signtool"  sign /t http://timestamp.digicert.com /a noobaa-setup.exe
)


echo "noobaa-setup.exe installer available under build\windows"

cd ..\..

exit 0
