#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=dist/build/uBlock0.browser

mkdir -p $DES/js
cp src/js/base64-custom.js           $DES/js
cp src/js/biditrie.js                $DES/js
cp src/js/filtering-context.js       $DES/js
cp src/js/hntrie.js                  $DES/js
cp src/js/static-filtering-parser.js $DES/js
cp src/js/static-net-filtering.js    $DES/js
cp src/js/static-filtering-io.js     $DES/js
cp src/js/text-utils.js              $DES/js
cp src/js/uri-utils.js               $DES/js

mkdir -p $DES/js/wasm
cp -R src/js/wasm $DES/js/

mkdir -p $DES/lib
cp -R src/lib/punycode.js      $DES/lib/
cp -R src/lib/publicsuffixlist $DES/lib/
cp -R src/lib/regexanalyzer    $DES/lib/

mkdir -p $DES/data
cp -R submodules/uAssets/thirdparties/publicsuffix.org/list/* \
      $DES/data
cp -R submodules/uAssets/thirdparties/easylist-downloads.adblockplus.org/* \
      $DES/data

cp platform/browser/*.html $DES/
cp platform/browser/*.js   $DES/
cp LICENSE.txt             $DES/
