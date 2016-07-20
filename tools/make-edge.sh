#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.edge: Creating web store package"
echo "*** uBlock0.edge: Copying files"

DES=dist/build/uBlock0.edge
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R src/css               $DES/
cp -R src/img               $DES/
cp -R src/js                $DES/
cp -R src/lib               $DES/
cp -R src/_locales          $DES/
cp -R $DES/_locales/nb      $DES/_locales/no
cp src/*.html               $DES/
cp platform/edge/*.js   $DES/js/
cp -R platform/edge/img $DES/
cp platform/edge/*.html $DES/
cp platform/edge/*.json $DES/
cp LICENSE.txt              $DES/

sed -i "s/'fullwide',\s*//g" $DES/js/*.js

if [ "$1" = all ]; then
    echo "*** uBlock0.edge: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0.edge.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** uBlock0.edge: Package done."
