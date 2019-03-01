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
cp    platform/chromium/vapi-usercss.real.js $DES/js/
cp    platform/firefox/bootstrap.js     $DES/
cp    platform/firefox/processScript.js $DES/
cp    platform/firefox/frame*.js        $DES/
cp -R platform/firefox/img              $DES/
cp    platform/firefox/chrome.manifest  $DES/
cp    platform/firefox/install.rdf      $DES/
cp    platform/firefox/*.xul            $DES/
cp    LICENSE.txt                       $DES/

echo "*** AdNauseam.firefox: concatenating content scripts"
cat $DES/js/vapi-usercss.real.js > /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.real.js >> /tmp/contentscript.js

echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/contentscript.js >> /tmp/contentscript.js
mv /tmp/contentscript.js $DES/js/contentscript.js
rm $DES/js/vapi-usercss.js
rm $DES/js/vapi-usercss.real.js
rm $DES/js/vapi-usercss.pseudo.js

# Firefox/webext-specific
rm $DES/img/icon_128.png

echo "*** AdNauseam::Firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/ "$2"
echo "*** AdNauseam.firefox: Generating web accessible resources..."
cp -R src/web_accessible_resources $DES/
python3 tools/import-war.py $DES/


if [ "$1" = all ]; then
    echo "*** AdNauseam::Firefox: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip artifacts/adnauseam.firefox.xpi -qr *
    popd > /dev/null
fi

echo "*** AdNauseam::Firefox: Package done."
echo

#cat $DES/popup.html | less
