#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.chromium: Creating web store package"
echo "*** uBlock.chromium: Copying files"
DES=dist/uBlock.chromium
mkdir -p $DES
cp -R assets $DES/
rm $DES/assets/*.sh
cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
rm $DES/js/vapi-background.js
rm $DES/js/vapi-client.js
rm $DES/js/vapi-common.js
cp -R src/lib $DES/
cp -R src/_locales $DES/
cp src/*.html $DES/
cp meta/crx/*.js $DES/js/
cp meta/crx/manifest.json $DES/
echo "*** uBlock.chromium: Package done."
