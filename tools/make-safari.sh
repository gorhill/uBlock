#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.safariextension: Copying files"

DES=dist/build/uBlock.safariextension
rm -rf $DES
mkdir -p $DES

cp -R assets $DES/
rm $DES/assets/*.sh
cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/
cp -R src/_locales $DES/
cp src/*.html $DES/
cp $DES/img/browsericons/icon16@2x.png $DES/Icon-32.png
cp $DES/img/browsericons/icon48.png $DES/Icon-48.png
cp $DES/img/browsericons/icon64.png $DES/Icon-64.png
cp $DES/img/browsericons/icon48@2x.png $DES/Icon-96.png
cp $DES/img/browsericons/icon128.png $DES/Icon-128.png
cp $DES/img/browsericons/icon128@2x.png $DES/Icon-256.png
cp platform/safari/*.js $DES/js/
cp platform/safari/Info.plist $DES/
cp platform/safari/Settings.plist $DES/
cp LICENSE.txt $DES/

echo "*** uBlock.safariextension: Generating meta..."
python tools/make-safari-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** Use Safari's Extension Builder to create the signed uBlock extension package -- can't automate it."
fi

echo "*** uBlock.safariextension: Package done."
