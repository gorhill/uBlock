#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.chromium: Creating web store package"
echo "*** uBlock.chromium: Copying files"
DES=dist/build/uBlock.chromium
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
cp meta/vapi-appinfo.js $DES/js/
cp platform/chromium/*.js $DES/js/
cp platform/chromium/manifest.json $DES/
echo "*** uBlock.chromium: Package done."
