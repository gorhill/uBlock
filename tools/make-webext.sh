#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.webext: Creating web store package"
echo "*** uBlock0.webext: Copying files"

DES=dist/build/uBlock0.webext
rm -rf $DES
mkdir -p $DES/webextension

bash ./tools/make-assets.sh $DES/webextension

cp -R src/css                         $DES/webextension/
cp -R src/img                         $DES/webextension/
cp -R src/js                          $DES/webextension/
cp -R src/lib                         $DES/webextension/
cp -R src/_locales                    $DES/webextension/
cp -R $DES/webextension/_locales/nb   $DES/webextension/_locales/no
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

echo "*** uBlock0.webext: Generating meta..."
python tools/make-webext-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.webext: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** uBlock0.webext: Package done."
