#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** adnauseam.opera: Creating web store package"
echo "*** adnauseam.opera: Copying files"

DES=bin/build/adnauseam.opera
rm -r $DES
mkdir -p $DES

./tools/make-assets.sh $DES

cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/

mkdir -p $DES/_locales
cp -R src/_locales/en $DES/_locales
cp -R src/_locales/zh_CN $DES/_locales
cp -R src/_locales/zh_TW $DES/_locales

cp src/*.html $DES/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.json $DES/
cp -R platform/chromium/img $DES/
cp platform/opera/manifest.json $DES/
cp LICENSE.txt $DES/

echo "*** adnauseam.opera: Package done."
