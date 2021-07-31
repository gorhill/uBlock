#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

mkdir $DES/thirdparties

git submodule update --depth 1 --init
UASSETS=submodules/uAssets

cp -R $UASSETS/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R $UASSETS/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R $UASSETS/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R $UASSETS/thirdparties/urlhaus-filter                     $DES/thirdparties/

mkdir $DES/ublock
cp -R $UASSETS/filters/* $DES/ublock/
# Optional filter lists: do not include in package
rm    $DES/ublock/annoyances.txt
