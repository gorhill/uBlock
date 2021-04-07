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

echo "*** AdNauseam.opera: Copying common files"
bash ./tools/copy-common-files.sh  $DES

# Opera-specific
cp platform/opera/manifest.json $DES/
rm -r $DES/_locales/az
rm -r $DES/_locales/cv
rm -r $DES/_locales/hi
rm -r $DES/_locales/hy
rm -r $DES/_locales/ka
rm -r $DES/_locales/kk
rm -r $DES/_locales/mr
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

echo "*** AdNauseam.opera: Generating meta..."
python tools/make-opera-meta.py $DES/

echo "*** AdNauseam.opera: Package done."
