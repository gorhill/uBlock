#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.opera: Creating web store package"
echo "*** uBlock0.opera: Copying files"

DES=dist/build/uBlock0.opera
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
cp platform/chromium/*.js $DES/js/
cp platform/chromium/*.json $DES/
cp -R platform/chromium/img $DES/

cp platform/opera/manifest.json $DES/
cp LICENSE.txt $DES/

rm -r $DES/_locales/hi
rm -r $DES/_locales/mr
rm -r $DES/_locales/sr
rm -r $DES/_locales/ta

echo "*** uBlock0.opera: Package done."
