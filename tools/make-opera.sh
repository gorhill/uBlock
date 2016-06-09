#!/usr/bin/env bash
#
# This script assumes a linux environment

hash jq 2>/dev/null || { echo; echo >&2 "Error: this script requires jq (https://stedolan.github.io/jq/), but it's not installed"; exit 1; }

echo "*** adnauseam.opera: Creating opera package"
echo "*** adnauseam.opera: Copying files"

DES=bin/build/adnauseam.opera

rm -r $DES
mkdir -p $DES

#VERSION=`jq .version platform/chromium/manifest.json`
VERSION=`jq .version manifest.json` # new-manifest

./tools/make-assets.sh $DES
./tools/make-locales.sh $DES

cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/

#mkdir -p $DES/_locales
#cp -R src/_locales/en $DES/_locales
#cp -R src/_locales/zh_CN $DES/_locales
#cp -R src/_locales/zh_TW $DES/_locales

cp src/*.html $DES/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.json $DES/
cp -R platform/chromium/img $DES/
cp platform/opera/manifest.json $DES/  # adn: overwrites chromium manifest
sed -i .bak "s/\"{version}\"/${VERSION}/" $DES/manifest.json
cp LICENSE.txt $DES/

echo "*** adnauseam.opera: Package done."

head $DES/manifest.json
