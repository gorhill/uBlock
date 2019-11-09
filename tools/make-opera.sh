#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock0.opera: Creating web store package"

DES=dist/build/uBlock0.opera
rm -rf $DES
mkdir -p $DES

echo "*** uBlock0.opera: copying common files"
bash ./tools/copy-common-files.sh  $DES

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

echo "*** uBlock0.opera: Generating meta..."
python tools/make-opera-meta.py $DES/

echo "*** uBlock0.opera: Package done."
