#!/usr/bin/env bash
#
# This script assumes an OS X environment

echo "*** AdNauseam::Chromium: Creating chrome package"
echo "*** AdNauseam::Chromium: Copying files"

if [ "$1" = experimental ]; then
    DES=dist/build/experimental/adnauseam.chromium
else
    DES=dist/build/adnauseam.chromium
fi
rm -rf $DES
mkdir -p $DES

UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version

bash ./tools/make-assets.sh $DES
bash ./tools/make-locales.sh $DES

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
cp manifest.json $DES/            # new-manifest
cp LICENSE.txt              $DES/


sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

echo "*** uBlock0.chromium: Generating meta..."
python tools/make-chromium-meta.py $DES/


if [ "$1" = all ]; then
    echo "*** AdNauseam::Chromium: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip artifacts/adnauseam.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** AdNauseam::Chromium: Package done."
echo

#ls -lR $DES
#cat $DES/popup.html | less
