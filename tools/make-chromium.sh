#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.chromium: Creating web store package"

DES=dist/build/uBlock0.chromium
rm -rf $DES
mkdir -p $DES

echo "*** uBlock0.chromium: copying common files"
bash ./tools/copy-common-files.sh  $DES

# Chrome store-specific
cp -R $DES/_locales/nb $DES/_locales/no

echo "*** uBlock0.chromium: Generating meta..."
python tools/make-chromium-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.chromium: Creating plain package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.chromium: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0_"$1".chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** uBlock0.chromium: Package done."
