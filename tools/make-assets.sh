#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

mkdir $DES/thirdparties

ASSETS_MAIN=dist/build/uAssets/main
ASSETS_PROD=dist/build/uAssets/prod

cp -R $ASSETS_MAIN/thirdparties/pgl.yoyo.org     $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/publicsuffix.org $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/urlhaus-filter   $DES/thirdparties/

mkdir -p $DES/thirdparties/easylist
cp $ASSETS_PROD/thirdparties/easy*.txt $DES/thirdparties/easylist/

mkdir $DES/ublock
cp $ASSETS_PROD/filters/* $DES/ublock/

# Do not include in package
rm $DES/ublock/annoyances.txt
rm $DES/ublock/lan-block.txt
rm $DES/ublock/ubol-filters.txt
