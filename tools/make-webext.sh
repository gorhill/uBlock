#!/usr/bin/env bash
#
# This script assumes a linux environment

# https://github.com/uBlockOrigin/uBlock-issues/issues/217
set -e

echo "*** uBlock0.webext: Creating web store package"

DES=dist/build/uBlock0.webext
rm -rf $DES
mkdir -p $DES

echo "*** uBlock0.webext: copying common files"
bash ./tools/copy-common-files.sh  $DES

cp -R $DES/_locales/nb                  $DES/_locales/no

cp platform/webext/manifest.json        $DES/

# https://github.com/uBlockOrigin/uBlock-issues/issues/407
echo "*** uBlock0.webext: concatenating vapi-webrequest.js"
cat platform/chromium/vapi-webrequest.js > /tmp/vapi-webrequest.js
grep -v "^'use strict';$" platform/firefox/vapi-webrequest.js >> /tmp/vapi-webrequest.js
mv /tmp/vapi-webrequest.js $DES/js/vapi-webrequest.js

echo "*** uBlock0.webext: Generating meta..."
python3 tools/make-webext-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.webext: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.webext: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr * -O ../uBlock0_"$1".webext.xpi
    popd > /dev/null
fi

echo "*** uBlock0.webext: Package done."
