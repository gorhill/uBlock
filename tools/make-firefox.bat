rem This script assumes a Windows environment
@echo off
echo "*** uBlock.firefox: Copying files"

set DES="%~dp0..\dist\build\uBlock.firefox"
rd /s /q %DES%
mkdir %DES%

pushd %~dp0..
xcopy /S /I assets %DES%\assets
del %DES%\assets\*.sh
xcopy /S /I src\css %DES%\css
xcopy /S /I src\img %DES%\img
xcopy /S /I src\js %DES%\js
xcopy /S /I src\lib %DES%\lib
xcopy /S /I src\_locales %DES%\_locales
xcopy src\*.html %DES%\
xcopy src\*.xul %DES%\
move %DES%\img\icon_128.png %DES%\icon.png
xcopy platform\firefox\vapi-*.js %DES%\js\
xcopy platform\firefox\bootstrap.js %DES%\
xcopy platform\firefox\frame*.js %DES%\
xcopy platform\firefox\chrome.manifest %DES%\
xcopy platform\firefox\install.rdf %DES%\
xcopy LICENSE.txt %DES%\

echo "*** uBlock.firefox: Generating meta..."
c:\python34\python "%~dp0\make-firefox-meta.py" %DES%\


if "%1"=="all" (
    echo "*** uBlock.firefox: Creating package..."
    pushd %DES%\
    del ..\uBlock.firefox.xpi
    "%ProgramW6432%\7-Zip\7z.exe" a -tzip -mx5 -bd ..\uBlock.firefox.xpi *
    popd
)

echo "*** uBlock.firefox: Package done."
popd