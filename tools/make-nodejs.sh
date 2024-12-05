#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=$1

mkdir -p $DES/js
cp src/js/arglist-parser.js          $DES/js
cp src/js/base64-custom.js           $DES/js
cp src/js/biditrie.js                $DES/js
cp src/js/dynamic-net-filtering.js   $DES/js
cp src/js/filtering-context.js       $DES/js
cp src/js/hnswitches.js              $DES/js
cp src/js/hntrie.js                  $DES/js
cp src/js/redirect-resources.js      $DES/js
cp src/js/s14e-serializer.js         $DES/js
cp src/js/static-dnr-filtering.js    $DES/js
cp src/js/static-filtering-parser.js $DES/js
cp src/js/static-net-filtering.js    $DES/js
cp src/js/static-filtering-io.js     $DES/js
cp src/js/tasks.js                   $DES/js
cp src/js/text-utils.js              $DES/js
cp src/js/urlskip.js                 $DES/js
cp src/js/uri-utils.js               $DES/js
cp src/js/url-net-filtering.js       $DES/js

mkdir -p $DES/lib
cp -R src/lib/csstree          $DES/lib/
cp -R src/lib/punycode.js      $DES/lib/
cp -R src/lib/regexanalyzer    $DES/lib/
cp -R src/lib/publicsuffixlist $DES/lib/

# Convert wasm modules into json arrays
mkdir -p $DES/js/wasm
cp src/js/wasm/* $DES/js/wasm/
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/js/wasm/hntrie.wasm')))" \
    > $DES/js/wasm/hntrie.wasm.json
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/js/wasm/biditrie.wasm')))" \
    > $DES/js/wasm/biditrie.wasm.json
node -pe "JSON.stringify(Array.from(fs.readFileSync('src/lib/publicsuffixlist/wasm/publicsuffixlist.wasm')))" \
    > $DES/lib/publicsuffixlist/wasm/publicsuffixlist.wasm.json

cp platform/nodejs/*.js      $DES/
cp LICENSE.txt               $DES/
