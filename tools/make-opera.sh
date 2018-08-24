#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.opera: Creating web store package"
echo "*** uBlock0.opera: Copying files"

DES=dist/build/uBlock0.opera
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R src/css               $DES/
cp -R src/img               $DES/
cp -R src/js                $DES/
cp -R src/lib               $DES/
cp -R src/_locales          $DES/
cp src/*.html               $DES/
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.json $DES/
cp LICENSE.txt              $DES/

echo "*** uBlock0.opera: concatenating content scripts"
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

# Opera-specific
cp platform/opera/manifest.json $DES/
rm -r $DES/_locales/az
rm -r $DES/_locales/cv
rm -r $DES/_locales/hi
rm -r $DES/_locales/ka
rm -r $DES/_locales/kk
rm -r $DES/_locales/mr
rm -r $DES/_locales/ta
rm -r $DES/_locales/th

echo "*** uBlock0.opera: Generating web accessible resources..."
cp -R src/web_accessible_resources $DES/
python3 tools/import-war.py $DES/

echo "*** uBlock0.opera: Generating meta..."
python tools/make-opera-meta.py $DES/

echo "*** uBlock0.opera: Package done."
