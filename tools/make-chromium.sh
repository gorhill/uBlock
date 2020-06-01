#!/usr/bin/env bash
#
# This script assumes an OS X environment

echo "*** AdNauseam.chromium: Creating chrome package"
echo "*** AdNauseam.chromium: Copying files"

if [ "$1" = experimental ]; then
    DES=dist/build/experimental/adnauseam.chromium
else
    DES=dist/build/adnauseam.chromium
fi

rm -rf $DES
mkdir -p $DES

UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version

echo "*** AdNauseam.chromium: copying common files"
bash ./tools/copy-common-files.sh  $DES

echo "*** AdNauseam.chromium: concatenating content scripts"
cat $DES/js/vapi-usercss.js > /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.real.js >> /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/vapi-usercss.pseudo.js >> /tmp/contentscript.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" $DES/js/contentscript.js >> /tmp/contentscript.js
mv /tmp/contentscript.js $DES/js/contentscript.js
rm $DES/js/vapi-usercss.js
rm $DES/js/vapi-usercss.real.js
rm $DES/js/vapi-usercss.pseudo.js

# Chrome store-specific
[[ -e $DES/_locales/nb ]] && cp -R $DES/_locales/nb $DES/_locales/no

echo "*** AdNauseam: Generating meta..."
python tools/make-chromium-meta.py $DES/
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

# Remove the following files
rm $DES/js/adn/tests.js
rm -R $DES/lib/qunit

if [ "$1" = all ]; then
    echo "*** AdNauseam.chromium: Creating package..."
    pushd $(dirname $DES/) > /dev/null
    zip artifacts/adnauseam.chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.chromium: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0_"$1".chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** AdNauseam.chromium: Package done."
