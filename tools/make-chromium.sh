#!/usr/bin/env bash
#
# This script assumes an OS X environment



echo "*** AdNauseam.chromium: Creating chrome package"

if [ "$1" = experimental ]; then
    DES=dist/build/experimental/adnauseam.chromium
else
    DES=dist/build/adnauseam.chromium
fi

rm -rf $DES
mkdir -p $DES

echo "*** AdNauseam.chromium: Copying common files"
bash ./tools/copy-common-files.sh $DES

# Chromium-specific
echo "*** AdNauseam.chromium: Copying chromium-specific files"
cp platform/chromium/*.js          $DES/js/
cp platform/chromium/*.html        $DES/

# Chrome store-specific
[[ -e $DES/_locales/nb ]] && cp -R $DES/_locales/nb $DES/_locales/no

echo "*** AdNauseam: Generating meta..."
python3 tools/make-chromium-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** AdNauseam.chromium: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip artifacts/adnauseam.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** AdNauseam.chromium: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam_"$1".chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** AdNauseam.chromium: Package done."
