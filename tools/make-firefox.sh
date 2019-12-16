#!/usr/bin/env bash
#
# This script assumes a linux environment
# https://github.com/uBlockOrigin/uBlock-issues/issues/217
set -e
echo "*** AdNauseam.firefox: Creating web store package"
echo "*** AdNauseam.firefox: Copying files"

DES=dist/build/adnauseam.firefox
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
cp LICENSE.txt                   $DES/

cp platform/webext/manifest.json        $DES/
cp platform/webext/vapi-usercss.js      $DES/js/

echo "*** AdNauseam.firefox: concatenating content scripts"
cat $DES/js/vapi-usercss.js > /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.real.js >> /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.pseudo.js >> /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/contentscript.js >> /tmp/contentscript.js
mv /tmp/contentscript.js $DES/js/contentscript.js
rm $DES/js/vapi-usercss.js
rm $DES/js/vapi-usercss.real.js
rm $DES/js/vapi-usercss.pseudo.js

# Webext-specific
rm $DES/img/icon_128.png
# Remove the following files
rm $DES/js/adn/tests.js
rm -R $DES/lib/qunit

sed -i '' "s/\"{version}\"/${VERSION}/" $DES/manifest.json
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

printf "*** AdNauseam.firefox: Generating web accessible resources...\n"
cp -R src/web_accessible_resources $DES/
python3 tools/import-war.py $DES/

if [ "$1" = all ]; then
    echo "*** AdNauseam.firefox: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam.firefox.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/uBlock0.firefox.xpi "$BLDIR"/uBlock0_"$1".firefox.xpi
fi

echo "*** AdNauseam.firefox: Package done."
echo
