#!/usr/bin/env bash
#
# This script assumes a linux environment

# https://github.com/uBlockOrigin/uBlock-issues/issues/217
set -e

echo "*** uBlock0.webext: Creating web store package"
echo "*** uBlock0.webext: Copying files"

DES=dist/build/uBlock0.webext
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R src/css                           $DES/
cp -R src/img                           $DES/
cp -R src/js                            $DES/
cp -R src/lib                           $DES/
cp -R src/_locales                      $DES/
cp -R $DES/_locales/nb                  $DES/_locales/no
cp src/*.html                           $DES/
cp platform/chromium/*.js               $DES/js/
cp platform/chromium/*.html             $DES/
cp platform/chromium/*.json             $DES/
cp LICENSE.txt                          $DES/

cp platform/webext/manifest.json        $DES/
cp platform/webext/vapi-usercss.js      $DES/js/

# https://github.com/uBlockOrigin/uBlock-issues/issues/407
echo "*** uBlock0.webext: concatenating vapi-webrequest.js"
cat platform/chromium/vapi-webrequest.js > /tmp/vapi-webrequest.js
echo >> /tmp/contentscript.js
grep -v "^'use strict';$" platform/firefox/vapi-webrequest.js >> /tmp/vapi-webrequest.js
mv /tmp/vapi-webrequest.js $DES/js/vapi-webrequest.js

echo "*** uBlock0.webext: concatenating content scripts"
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

echo "*** uBlock0.webext: Generating web accessible resources..."
cp -R src/web_accessible_resources $DES/
python3 tools/import-war.py $DES/

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
