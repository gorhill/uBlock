#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=dist/build/uBlock0.nodejs

mkdir -p $DES/js
cp src/js/base64-custom.js           $DES/js
cp src/js/biditrie.js                $DES/js
cp src/js/filtering-context.js       $DES/js
cp src/js/globals.js                 $DES/js
cp src/js/hntrie.js                  $DES/js
cp src/js/static-filtering-parser.js $DES/js
cp src/js/static-net-filtering.js    $DES/js
cp src/js/static-filtering-io.js     $DES/js
cp src/js/text-iterators.js          $DES/js
cp src/js/uri-utils.js               $DES/js

mkdir -p $DES/lib
cp -R src/lib/punycode.js      $DES/lib/
cp -R src/lib/publicsuffixlist $DES/lib/
cp -R src/lib/regexanalyzer    $DES/lib/

# https://github.com/uBlockOrigin/uBlock-issues/issues/1664#issuecomment-888332409
THIRDPARTY=../uAssets/thirdparties/publicsuffix.org
mkdir -p $DES/data
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/list/effective_tld_names.dat', 'utf8'))" \
    > $DES/data/effective_tld_names.json
THIRDPARTY=../uAssets/thirdparties/easylist-downloads.adblockplus.org
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easylist.txt', 'utf8'))" \
    > $DES/data/easylist.json
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easyprivacy.txt', 'utf8'))" \
    > $DES/data/easyprivacy.json

cp platform/nodejs/*.js   $DES/
cp platform/nodejs/*.json $DES/
cp LICENSE.txt            $DES/
