#!/usr/bin/env bash
#
# This script assumes an OS X environment

echo "*** AdNauseam.edge: Creating edge package"

DES=dist/build/adnauseam.edge
CHROMIUM=dist/build/adnauseam.chromium

rm -rf $DES
mkdir -p $DES

if [ ! -d "$CHROMIUM" ]; then
    echo "$CHROMIUM does not exist"
    ./tools/make-chromium.sh
fi

echo "*** AdNauseam.edge: Copying files"
cp -R $CHROMIUM/* $DES/

# Modify manifest
echo "*** AdNauseam.edge: Modify manifest for edge"
# Remove "update_url"
sed -i '' -e '/^  "update_url"/d' $DES/manifest.json

echo "*** AdNauseam.edge: Package done."
echo
