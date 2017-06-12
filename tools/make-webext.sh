#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam::WebExt: Creating web store package"
echo "*** AdNauseam::WebExt: Copying files"

DES=dist/build/adnauseam.webext
rm -rf $DES
mkdir -p $DES/webextension

VERSION=`jq .version manifest.json` # top-level adnauseam manifest
UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version no quotes

bash ./tools/make-assets.sh $DES
bash ./tools/make-locales.sh $DES

cp -R src/css                    $DES/
cp -R src/img                    $DES/
cp -R src/js                     $DES/
cp -R src/lib                    $DES/
#cp -R src/_locales               $DES/
#cp -R $DES/_locales/nb           $DES/_locales/no
cp src/*.html                    $DES/
cp platform/chromium/*.js        $DES/js/
cp -R platform/chromium/img      $DES/
cp platform/chromium/*.html      $DES/
cp platform/chromium/*.json      $DES/
cp platform/webext/polyfill.js   $DES/js/
cp platform/webext/manifest.json $DES/
cp LICENSE.txt                   $DES/

echo "*** AdNauseam::WebExt: Generating meta..."
# python tools/make-webext-meta.py $DES/     ADN: use our own version
#

sed -i '' "s/\"{version}\"/${VERSION}/" $DES/manifest.json
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

if [ "$1" = all ]; then
    echo "*** AdNauseam::WebExt: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam.webext.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** AdNauseam::WebExt: Package done."
echo
