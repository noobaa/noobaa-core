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
copy ..\..\package.json .
copy ..\..\binding.gyp .
copy ..\..\config.js .
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

echo "Build 32 bit"
nvm install "%NODEJS_VERSION%" 32 || exit 1
nvm use "%NODEJS_VERSION%" 32 || exit 1
sleep 5
nvm list
nvm arch
node -p process.arch
cmd /c npm config set msvs_version=2015 --global
cmd /c npm install --production || exit 1

echo "Copy 32 bit build results"
if not exist ".\build\Release" exit 1
xcopy /Y/I/E .\build\Release .\build\Release-32

echo "Cleaning previous build"
rd /q/s .\build\Release
rd /q/s %USERPROFILE%\.node-gyp

echo "Build 64 bit"
nvm install "%NODEJS_VERSION%" 64 || exit 1
nvm use "%NODEJS_VERSION%" 64 || exit 1
sleep 5
nvm list
nvm arch
node -p process.arch
cmd /c npm config set msvs_version=2015 --global
cmd /c npm install --production || exit 1

echo "Copy 64 bit build results"
if not exist ".\build\Release" exit 1
xcopy /Y/I/E .\build\Release .\build\Release-64

curl -L https://nodejs.org/dist/v%NODEJS_VERSION%/win-x86/node.exe > node-32.exe || exit 1
curl -L https://nodejs.org/dist/v%NODEJS_VERSION%/win-x64/node.exe > node-64.exe || exit 1
curl -L https://indy.fulgan.com/SSL/openssl-1.0.2l-i386-win32.zip  > openssl_32.zip || exit 1
curl -L https://indy.fulgan.com/SSL/openssl-1.0.2l-x64_86-win64.zip> openssl_64.zip || exit 1

mkdir .\32
mkdir .\64

rd /q/s .\build\Release
rd /q/s .\build\src
rd /q/s .\build\Windows
del /q .\build\*.*

7za.exe e openssl_32.zip -y -x!*.txt || exit 1
del /Q openssl_32.zip

copy /y *.dll .\32\
copy /y node-32.exe .\32\node.exe
copy /y openssl.exe .\32\openssl.exe

del /Q *.dll
del /Q node-32.exe
del /Q openssl.exe

7za.exe e openssl_64.zip -y -x!*.txt || exit 1
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

makensis -NOCD ..\..\src\deploy\windows_rest_script.nsi || exit 1

set FINAL_SETUP_FILE_NAME=noobaa-s3rest-%current_package_version%-%GIT_COMMIT%.exe
rename noobaa-s3rest.exe %FINAL_SETUP_FILE_NAME%

if exist "%SIGNTOOL_PATH%" (
    echo "Signing installer with %SIGNTOOL_PATH%"
    "%SIGNTOOL_PATH%" sign /v /sm /t http://timestamp.comodoca.com /a %FINAL_SETUP_FILE_NAME% || exit 1
)

echo "%FINAL_SETUP_FILE_NAME% installer available under build\windows"

cd ..\..

exit 0
