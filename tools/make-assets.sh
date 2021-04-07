#!/usr/bin/env bash
#
# This script assumes a linux/OSX environment

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

cp -R ./thirdparties/www.eff.org                                 $DES/thirdparties/ # ADN

mkdir -p $DES/ublock
cp -R ../uAssets/filters/*                                       $DES/ublock/
# Optional filter lists: do not include in package

rm    $DES/ublock/annoyances.txt
cp -R ./filters/adnauseam.txt                                    $DES/ublock/ # ADN

echo "done."
