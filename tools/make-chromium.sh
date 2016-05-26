#!/usr/bin/env bash
#
# This script assumes a linux environment

hash jq 2>/dev/null || { echo; echo >&2 "Error: this script requires jq (https://stedolan.github.io/jq/), but it's not installed"; exit 1; }

echo "*** adnauseam.chromium: Creating web store package"
echo "*** adnauseam.chromium: Copying files"

DES=bin/build/adnauseam.chromium
rm -rf $DES
mkdir -p $DES

./tools/make-assets.sh $DES

# handle concatenating local files

FILES=src/_locales/**/adnauseam.json
for adnfile in $FILES
do
  messages="${adnfile/adnauseam/messages}"
  out="${messages/src/$DES}"
  dir=`dirname $out`
  mkdir -p $dir && touch $out
  echo Writing $out
  jq -s '.[0] * .[1]' $messages $adnfile > $out
done


cp -R src/css               $DES/
cp -R src/img               $DES/
cp -R src/js                $DES/
cp -R src/lib               $DES/
#cp -R src/_locales          $DES/
#cp -R $DES/_locales/nb      $DES/_locales/no
cp src/*.html               $DES/
cp platform/chromium/*.js   $DES/js/
cp -R platform/chromium/img $DES/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.json $DES/
cp LICENSE.txt              $DES/

if [ "$1" = all ]; then
    echo "*** adnauseam.chromium: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip adnauseam.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** adnauseam.chromium: Package done."
