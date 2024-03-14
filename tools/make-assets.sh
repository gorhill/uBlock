#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

VERSION=$(cat ./dist/version)
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "*** Removing $DES/assets.dev.json"
    rm -f $DES/assets.dev.json
else
    echo "*** Removing $DES/assets.json"
    rm -f $DES/assets.json
fi

mkdir $DES/thirdparties

ASSETS_MAIN=dist/build/uAssets/main
ASSETS_PROD=dist/build/uAssets/prod

cp -R $ASSETS_MAIN/thirdparties/pgl.yoyo.org     $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/publicsuffix.org $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/urlhaus-filter   $DES/thirdparties/

mkdir -p $DES/thirdparties/easylist
cp $ASSETS_PROD/thirdparties/easylist.txt $DES/thirdparties/easylist/
cp $ASSETS_PROD/thirdparties/easyprivacy.txt $DES/thirdparties/easylist/

mkdir $DES/ublock
cp $ASSETS_PROD/filters/badlists.txt $DES/ublock/badlists.txt
cp $ASSETS_PROD/filters/badware.min.txt $DES/ublock/badware.min.txt
cp $ASSETS_PROD/filters/filters.min.txt $DES/ublock/filters.min.txt
cp $ASSETS_PROD/filters/privacy.min.txt $DES/ublock/privacy.min.txt
cp $ASSETS_PROD/filters/quick-fixes.min.txt $DES/ublock/quick-fixes.min.txt
cp $ASSETS_PROD/filters/unbreak.min.txt $DES/ublock/unbreak.min.txt
