@echo off
cd %~dp0
call make-firefox.bat all
"%ProgramFiles(x86)%\Android\android-sdk\platform-tools\adb" push ..\dist\build\uBlock.firefox.xpi /mnt/sdcard/
"%ProgramFiles(x86)%\Android\android-sdk\platform-tools\adb" shell am start -a android.intent.action.VIEW -c android.intent.category.DEFAULT -d file:///mnt/sdcard/uBlock.firefox.xpi -n org.mozilla.firefox/.App