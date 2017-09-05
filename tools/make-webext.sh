#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.webext: Creating web store package"
echo "*** uBlock0.webext: Copying files"

DES=dist/build/uBlock0.webext
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R src/css                           $DES/
cp -R src/img                           $DES/
cp -R src/js                            $DES/
cp -R src/lib                           $DES/
cp -R src/_locales                      $DES/
cp -R $DES/_locales/nb                  $DES/_locales/no
cp src/*.html                           $DES/
cp platform/chromium/*.js               $DES/js/
cp -R platform/chromium/img             $DES/
cp platform/chromium/*.html             $DES/
cp platform/chromium/*.json             $DES/
cp LICENSE.txt                          $DES/

cp platform/webext/manifest.json        $DES/
cp platform/webext/options_ui.html      $DES/
cp platform/webext/polyfill.js          $DES/js/
cp platform/webext/vapi-webrequest.js   $DES/js/
cp platform/webext/vapi-cachestorage.js $DES/js/
cp platform/webext/vapi-usercss.js      $DES/js/
rm $DES/js/options_ui.js

echo "*** uBlock0.webext: Generating meta..."
python tools/make-webext-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.webext: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** uBlock0.webext: Package done."
