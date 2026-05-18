#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam.firefox: Creating web store package"

BLDIR=dist/build
DES="$BLDIR"/adnauseam.firefox
mkdir -p $DES
rm -rf $DES/*

VERSION=`jq .version manifest.json` # top-level adnauseam manifest

echo "*** AdNauseam.firefox: Copying common files"
bash ./tools/copy-common-files.sh  $DES

# Firefox-specific
echo "*** AdNauseam.firefox: Copying firefox-specific files"
cp platform/firefox/*.json         $DES/
cp platform/firefox/*.js           $DES/js/


# Firefox store-specific
cp -R $DES/_locales/nb     $DES/_locales/no

# Webext-specific
rm $DES/img/icon_128.png

awk -v s=$VERSION '{gsub(/"{version}"/, s)}1' $DES/manifest.json > /tmp/manifest.json && mv /tmp/manifest.json $DES/manifest.json

echo "*** AdNauseam.firefox: Generating meta..."
python3 tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** AdNauseam.firefox: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam.firefox.xpi -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** AdNauseam.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/adnauseam.firefox.xpi "$BLDIR"/adnauseam_"$1".firefox.xpi
fi

echo "*** AdNauseam.firefox: Package done."
echo
