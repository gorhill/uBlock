#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.firefox: Creating web store package"

BLDIR=dist/build
DES="$BLDIR"/uBlock0.firefox
rm -rf $DES
mkdir -p $DES

echo "*** uBlock0.firefox: copying common files"
bash ./tools/copy-common-files.sh  $DES

cp -R $DES/_locales/nb                 $DES/_locales/no

cp platform/firefox/manifest.json      $DES/
cp platform/firefox/webext.js          $DES/js/
cp platform/firefox/vapi-webrequest.js $DES/js/

# Firefox/webext-specific
rm $DES/img/icon_128.png

echo "*** uBlock0.firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.firefox: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/uBlock0.firefox.xpi "$BLDIR"/uBlock0_"$1".firefox.xpi
fi

echo "*** uBlock0.firefox: Package done."
