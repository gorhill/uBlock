#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** adnauseam.chromium: Creating web store package"
echo "*** adnauseam.chromium: Copying files"

DES=dist/build/adnauseam.chromium
rm -rf $DES
mkdir -p $DES

cp -R assets $DES/
rm $DES/assets/*.sh
cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/
cp -R src/_locales $DES/
cp -R $DES/_locales/nb $DES/_locales/no
cp src/*.html $DES/
cp platform/chromium/*.js $DES/js/
cp -R platform/chromium/img $DES/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.json $DES/

cp tools/adn/chromium/manifest.json $DES/       #adn#

cp LICENSE.txt $DES/

ls -lR $DES
ls -l $DES/js/adn/content.js
cat $DES/manifest.json

if [ "$1" = all ]; then
    echo "*** adnauseam.chromium: Creating package..."
    pushd $(dirname $DES/)
    zip adnauseam.chromium.zip -qr $(basename $DES/)/*
    popd
fi

echo "*** adnauseam.chromium: Package done."
