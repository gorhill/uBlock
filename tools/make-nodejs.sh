#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=dist/build/uBlock0.nodejs

# Save existing npm dependencies if present so that we do not have to fetch
# them all again
if [ -d "$DES/node_modules" ]; then
    TMPDIR=`mktemp -d`
    mv "$DES/node_modules" "$TMPDIR/node_modules"
fi

rm -rf $DES

mkdir -p $DES/js
cp src/js/base64-custom.js           $DES/js
cp src/js/biditrie.js                $DES/js
cp src/js/dynamic-net-filtering.js   $DES/js
cp src/js/filtering-context.js       $DES/js
cp src/js/globals.js                 $DES/js
cp src/js/hnswitches.js              $DES/js
cp src/js/hntrie.js                  $DES/js
cp src/js/static-filtering-parser.js $DES/js
cp src/js/static-net-filtering.js    $DES/js
cp src/js/static-filtering-io.js     $DES/js
cp src/js/text-utils.js              $DES/js
cp src/js/uri-utils.js               $DES/js
cp src/js/url-net-filtering.js       $DES/js

mkdir -p $DES/lib
cp -R src/lib/punycode.js      $DES/lib/
cp -R src/lib/regexanalyzer    $DES/lib/
cp -R src/lib/publicsuffixlist $DES/lib/

# Convert wasm modules into json arrays
mkdir -p $DES/js/wasm
cp src/js/wasm/*                     $DES/js/wasm/
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/js/wasm/hntrie.wasm')))" \
    > $DES/js/wasm/hntrie.wasm.json
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/js/wasm/biditrie.wasm')))" \
    > $DES/js/wasm/biditrie.wasm.json
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/lib/publicsuffixlist/wasm/publicsuffixlist.wasm')))" \
    > $DES/lib/publicsuffixlist/wasm/publicsuffixlist.wasm.json

git submodule update --depth 1 --init
UASSETS=submodules/uAssets

# https://github.com/uBlockOrigin/uBlock-issues/issues/1664#issuecomment-888332409
THIRDPARTY=$UASSETS/thirdparties/publicsuffix.org
mkdir -p $DES/data
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/list/effective_tld_names.dat', 'utf8'))" \
    > $DES/data/effective_tld_names.json
THIRDPARTY=$UASSETS/thirdparties/easylist-downloads.adblockplus.org
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easylist.txt', 'utf8'))" \
    > $DES/data/easylist.json
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easyprivacy.txt', 'utf8'))" \
    > $DES/data/easyprivacy.json

cp platform/nodejs/.npmrc    $DES/
cp platform/nodejs/.*.json   $DES/
cp platform/nodejs/*.js      $DES/
cp platform/nodejs/*.json    $DES/
cp platform/nodejs/README.md $DES/
cp LICENSE.txt               $DES/
cp -R platform/nodejs/tests  $DES/

cd $DES
npm run build
tarballname=$(npm pack 2> /dev/null)
if [ "$1" ]; then
    echo "*** uBlock0.nodejs: Creating versioned package..."
    mv $tarballname ../uBlock0_"$1".nodejs.tgz
else
    echo "*** uBlock0.nodejs: Creating plain package..."
    mv $tarballname ../uBlock0.nodejs.tgz
fi
cd -

# Restore saved npm dependencies
if [ -n "$TMPDIR" ]; then
    mv "$TMPDIR/node_modules" "$DES/node_modules"
    rmdir "$TMPDIR"
fi

echo "*** uBlock0.nodejs: Package done."
