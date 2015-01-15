#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.safariextension: Copying files"

DES=dist/build/uBlock.safariextension
rm -r $DES
mkdir -p $DES

cp -R assets $DES/
rm $DES/assets/*.sh
cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/
cp -R src/_locales $DES/
cp src/*.html $DES/
mv $DES/img/icon_128.png $DES/Icon.png
cp platform/safari/*.js $DES/js/
cp platform/safari/Info.plist $DES/
cp platform/safari/Settings.plist $DES/
cp LICENSE.txt $DES/

echo "*** uBlock.safariextension: Generating meta..."
python tools/make-safari-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock.safariextension: Creating package..."
    pushd $DES/
    zip ../uBlock.safari.safariextension -qr *
    popd
fi

echo "*** uBlock.safariextension: Package done."
