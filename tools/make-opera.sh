#!/usr/bin/env bash
#
# This script assumes a linux environment

hash jq 2>/dev/null || { echo; echo >&2 "Error: this script requires jq (https://stedolan.github.io/jq/), but it's not installed"; exit 1; }

echo "*** AdNauseam.opera: Creating opera package"
echo "*** AdNauseam.opera: Copying files"

DES=dist/build/adnauseam.opera

rm -rf $DES
mkdir -p $DES

VERSION=`jq .version manifest.json` # top-level adnauseam manifest
UBLOCK=`jq .version platform/chromium/manifest.json | tr -d '"'` # ublock-version no quotes

bash ./tools/make-assets.sh $DES
bash ./tools/make-locales.sh $DES

cp -R src/css $DES/
cp -R src/img $DES/
cp -R src/js $DES/
cp -R src/lib $DES/

cp src/*.html $DES/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.js   $DES/js/
cp platform/chromium/*.html $DES/
cp platform/chromium/*.json $DES/
cp LICENSE.txt              $DES/

echo "*** AdNauseam.opera: concatenating content scripts"
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

cp platform/opera/manifest.json $DES/  # adn: overwrites chromium manifest
cp LICENSE.txt $DES/

sed -i '' "s/\"{version}\"/${VERSION}/" $DES/manifest.json
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/popup.html
sed -i '' "s/{UBLOCK_VERSION}/${UBLOCK}/" $DES/links.html

# Remove the following files
rm $DES/js/adn/tests.js
rm -R $DES/lib/qunit

# Removing WASM modules until I receive an answer from Opera people: Opera's
# uploader issue an error for hntrie.wasm and this prevents me from
# updating uBO in the Opera store. The modules are unused anyway for
# Chromium- based browsers.
rm $DES/js/wasm/*.wasm
rm $DES/js/wasm/*.wat
rm $DES/lib/lz4/*.wasm
rm $DES/lib/lz4/*.wat
rm $DES/lib/publicsuffixlist/wasm/*.wasm
rm $DES/lib/publicsuffixlist/wasm/*.wat

echo "*** AdNauseam.opera: Package Done."
echo

# printf "*** AdNauseam.opera: Generating web accessible resources...\n"
cp -R src/web_accessible_resources $DES/
python3 tools/import-war.py $DES/
