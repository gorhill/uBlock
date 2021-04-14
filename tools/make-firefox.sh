#!/usr/bin/env bash
#
# This script assumes a linux environment
echo "*** AdNauseam.firefox: Creating web store package"

BLDIR=dist/build
DES="$BLDIR"/adnauseam.firefox
rm -rf $DES
mkdir -p $DES/webextension

VERSION=`jq .version manifest.json` # top-level adnauseam manifest

echo "*** AdNauseam.firefox: Copying common files"
bash ./tools/copy-common-files.sh  $DES

cp platform/firefox/manifest.json      $DES/
cp platform/firefox/webext.js          $DES/js/
cp platform/firefox/vapi-webrequest.js $DES/js/

# Webext-specific
rm $DES/img/icon_128.png

sed -i '' "s/\"{version}\"/${VERSION}/" $DES/manifest.json

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
