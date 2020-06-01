#!/usr/bin/env bash
#
# This script assumes a linux environment
# https://github.com/uBlockOrigin/uBlock-issues/issues/217
set -e
echo "*** AdNauseam.firefox: Creating web store package"
echo "*** AdNauseam.firefox: Copying files"

BLDIR=dist/build
DES="$BLDIR"/adnauseam.firefox
rm -rf $DES
mkdir -p $DES/webextension

VERSION=`jq .version manifest.json` # top-level adnauseam manifest
UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version no quotes


echo "*** AdNauseam.firefox: copying common files"
bash ./tools/copy-common-files.sh  $DES

cp -R $DES/_locales/nb                 $DES/_locales/no

cp platform/firefox/manifest.json      $DES/
cp platform/firefox/webext.js          $DES/js/
cp platform/firefox/vapi-usercss.js    $DES/js/
cp platform/firefox/vapi-webrequest.js $DES/js/

echo "*** AdNauseam.firefox: concatenating content scripts"
cat $DES/js/vapi-usercss.js > /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.real.js >> /tmp/contentscript.js
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

echo "*** AdNauseam.firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** AdNauseam.firefox: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam.firefox.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** AdNauseam.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/uBlock0.firefox.xpi "$BLDIR"/uBlock0_"$1".firefox.xpi
fi

echo "*** AdNauseam.firefox: Package done."
echo
