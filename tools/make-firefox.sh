#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock.firefox: Copying files"

DES=dist/build/uBlock.firefox
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
mv $DES/img/icon_128.png $DES/icon.png
cp platform/firefox/vapi-*.js $DES/js/
cp platform/firefox/bootstrap.js $DES/
cp platform/firefox/frame*.js $DES/
cp -R platform/firefox/img $DES/
cp -R platform/firefox/css $DES/
cp platform/firefox/chrome.manifest $DES/
cp platform/firefox/install.rdf $DES/
cp platform/firefox/*.xul $DES/
cp LICENSE.txt $DES/

echo "*** uBlock.firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock.firefox: Creating package..."
    pushd $DES/
    zip ../uBlock.firefox.xpi -qr *
    popd
fi

echo "*** uBlock.firefox: Package done."
