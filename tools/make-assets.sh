#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1/assets

printf "*** Packaging assets in $DES... "

if [ -n "${TRAVIS_TAG}" ]; then
  pushd .. > /dev/null
  git clone --depth 1 https://github.com/uBlockOrigin/uAssets.git
  popd > /dev/null
fi

rm -rf $DES
mkdir $DES
cp    ./assets/assets.json                                       $DES/

mkdir $DES/thirdparties
cp -R ../uAssets/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R ../uAssets/thirdparties/mirror1.malwaredomains.com         $DES/thirdparties/
cp -R ../uAssets/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R ../uAssets/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R ../uAssets/thirdparties/www.malwaredomainlist.com          $DES/thirdparties/

mkdir $DES/ublock
cp -R ../uAssets/filters/*                                       $DES/ublock/
# Optional filter lists: do not include in package
rm    $DES/ublock/annoyances.txt

echo "done."
