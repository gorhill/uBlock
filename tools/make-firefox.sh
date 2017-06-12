#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam::Firefox: Copying files"

DES=dist/build/adnauseam.firefox
rm -rf $DES
mkdir -p $DES

#VERSION=`jq .version manifest.json` # top-level adnauseam manifest
UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version no quotes

bash ./tools/make-assets.sh $DES
bash ./tools/make-locales.sh $DES  # locale

cp -R src/css                           $DES/
cp -R src/img                           $DES/
cp -R src/js                            $DES/
cp -R src/lib                           $DES/
#cp -R src/_locales                      $DES/
cp    src/*.html                        $DES/

sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

mv    $DES/img/icon_128.png             $DES/icon.png
cp    platform/firefox/css/*            $DES/css/
cp    platform/firefox/polyfill.js      $DES/js/
cp    platform/firefox/vapi-*.js        $DES/js/
cp    platform/firefox/bootstrap.js     $DES/
cp    platform/firefox/processScript.js $DES/
cp    platform/firefox/frame*.js        $DES/
cp -R platform/firefox/img              $DES/
cp    platform/firefox/chrome.manifest  $DES/
cp    platform/firefox/install.rdf      $DES/
cp    platform/firefox/*.xul            $DES/
cp    LICENSE.txt                       $DES/

echo "*** AdNauseam::Firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/ "$2"


if [ "$1" = all ]; then
    echo "*** AdNauseam::Firefox: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip artifacts/adnauseam.firefox.xpi -qr *
    popd > /dev/null
fi

echo "*** AdNauseam::Firefox: Package done."
echo

#cat $DES/popup.html | less
