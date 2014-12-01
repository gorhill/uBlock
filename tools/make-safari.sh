#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.safariextension: Copying files"
DES=dist/build/uBlock.safariextension
rm -r $DES
mkdir -p $DES
cp -R assets $DES/
rm $DES/assets/*.sh
cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/
cp -R src/_locales $DES/
cp src/*.html $DES/
cp src/img/icon_128.png $DES/Icon.png
cp platform/vapi-appinfo.js $DES/js/
cp platform/safariextz/*.js $DES/js/
cp platform/safariextz/Info.plist $DES/
cp platform/safariextz/Settings.plist $DES/
echo "*** uBlock.safariextension: Package done."
