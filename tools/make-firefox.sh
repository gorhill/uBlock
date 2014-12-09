#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock_xpi: Copying files"
# use underscore instead of a dot!
DES=dist/build/uBlock_xpi
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
cp src/img/icon_128.png $DES/icon.png
cp platform/firefox/vapi-*.js $DES/js/
cp platform/firefox/bootstrap.js $DES/
cp platform/firefox/frameScript.js $DES/
cp platform/firefox/frameModule.js $DES/
cp platform/firefox/chrome.manifest $DES/
cp platform/firefox/install.rdf $DES/

echo "*** uBlock_xpi: Generating locales"
python tools/make-locale-firefox.py $DES/

echo "*** uBlock_xpi: Package done."
