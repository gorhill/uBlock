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
cp -R ./assets $DES/

mkdir $DES/thirdparties
cp -R ../uAssets/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R ../uAssets/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R ../uAssets/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R ../uAssets/thirdparties/urlhaus-filter                     $DES/thirdparties/

mkdir $DES/ublock
cp -R ../uAssets/filters/*                                       $DES/ublock/
# Optional filter lists: do not include in package
rm    $DES/ublock/annoyances.txt

echo "done."
