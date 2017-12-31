cls

REM  default - clean build
set CLEAN=true
set GIT_COMMIT=DEVONLY
set /p NODEJS_VERSION=<.\.nvmrc

REM Read input parameters in the form of "CLEAN:false"
FOR %%A IN (%*) DO (
   FOR /f "tokens=1,2 delims=:" %%G IN ("%%A") DO set %%G=%%H
)

echo "CLEAN = %CLEAN%"
echo "GIT_COMMIT = %GIT_COMMIT%"
echo "NODEJS_VERSION = %NODEJS_VERSION%"

IF %CLEAN%==false GOTO SKIP_BUILD
cmd /c npm cache clean

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
copy ..\..\LICENSE .
copy ..\..\config.js .
copy ..\..\binding.gyp .
copy ..\..\package.json .
mkdir .\src\
xcopy /Y/I/E ..\..\src\agent .\src\agent
xcopy /Y/I/E ..\..\src\s3 .\src\s3
xcopy /Y/I/E ..\..\src\sdk .\src\sdk
xcopy /Y/I/E ..\..\src\endpoint .\src\endpoint
xcopy /Y/I/E ..\..\src\rpc .\src\rpc
xcopy /Y/I/E ..\..\src\api .\src\api
xcopy /Y/I/E ..\..\src\util .\src\util
xcopy /Y/I/E ..\..\src\tools .\src\tools
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

REM remove irrelevant packages
type package.json | findstr /v mocha | findstr /v istanbul | findstr /v gulp | findstr /v eslint | findstr /v vsphere > package.json_s
del /Q package.json
rename package.json_s package.json

echo "Cleaning previous build"
rd /q/s .\build\Release
rd /q/s %USERPROFILE%\.node-gyp

echo "Build"
nvm install "%NODEJS_VERSION%" 64 || exit 1
nvm use "%NODEJS_VERSION%" 64 || exit 1
sleep 5
nvm list
nvm arch
node -p process.arch
cmd /c npm config set msvs_version=2015 --global
cmd /c npm install --production || exit 1
if not exist ".\build\Release" exit 1

rd /q/s .\src\native
rd /q/s .\build\src
rd /q/s .\build\Windows
del /q .\build\*.*

curl -L https://nodejs.org/dist/v%NODEJS_VERSION%/win-x64/node.exe > node.exe || exit 1

curl -L https://storage.googleapis.com/noobaa-temp/openssl/openssl-1.0.2l-x64_86-win64.zip > openssl.zip || exit 1
7za.exe e openssl.zip -y -x!*.txt || exit 1
del /Q openssl.zip
del /s *.pdb

cd ..\..
echo "done building"

:SKIP_BUILD

cd build\windows

echo "building installer"

makensis -NOCD ..\..\src\deploy\atom_agent_win.nsi || exit 1

set FINAL_SETUP_FILE_NAME=noobaa-setup-%current_package_version%-%GIT_COMMIT%.exe
rename noobaa-setup.exe %FINAL_SETUP_FILE_NAME%

if exist "%SIGNTOOL_PATH%" (
    echo "Signing installer with %SIGNTOOL_PATH%"
    "%SIGNTOOL_PATH%" sign /v /s my /t http://timestamp.digicert.com /a %FINAL_SETUP_FILE_NAME% || exit 1
)

echo "%FINAL_SETUP_FILE_NAME% installer available under build\windows"

cd ..\..

exit 0
