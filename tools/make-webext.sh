#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam::WebExt: Creating web store package"
echo "*** AdNauseam::WebExt: Copying files"

DES=dist/build/adnauseam.webext
rm -rf $DES
mkdir -p $DES/webextension


cp -R src/css                         $DES/webextension/
cp -R src/img                         $DES/webextension/
cp -R src/js                          $DES/webextension/
cp -R src/lib                         $DES/webextension/
#cp -R src/_locales                    $DES/webextension/
#cp -R $DES/webextension/_locales/nb   $DES/webextension/_locales/no
cp src/*.html                         $DES/webextension/
cp platform/chromium/*.js             $DES/webextension/js/
cp -R platform/chromium/img           $DES/webextension/
cp platform/chromium/*.html           $DES/webextension/
cp platform/chromium/*.json           $DES/webextension/
cp platform/webext/polyfill.js        $DES/webextension/js/
cp LICENSE.txt                        $DES/webextension/

cp platform/webext/background.html    $DES/webextension/
cp platform/webext/from-legacy.js     $DES/webextension/js/
cp platform/webext/manifest.json      $DES/webextension/
cp platform/webext/bootstrap.js       $DES/
cp platform/webext/chrome.manifest    $DES/
cp platform/webext/install.rdf        $DES/
mv $DES/webextension/img/icon_128.png $DES/icon.png

echo "*** AdNauseam::WebExt: Generating meta..."
# python tools/make-webext-meta.py $DES/     ADN: use our own version
#

sed -i '' "s/\"{version}\"/${VERSION}/" $DES/manifest.json
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

if [ "$1" = all ]; then
    echo "*** AdNauseam::WebExt: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** AdNauseam::WebExt: Package done."
echo
