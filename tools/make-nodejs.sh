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

# Use existing uAssets, or git-clone a temporary one
if [ -d "../uAssets" ]; then
    UASSETS=../uAssets
else
    echo "*** ../uAssets not present, git-cloning..."
    TMPDIR=$(mktemp -d)
    UASSETS=$TMPDIR/uAssets
    git clone --depth=1 https://github.com/uBlockOrigin/uAssets.git $UASSETS
fi

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

# Remove temporary git-clone uAssets
if [ -n "$TMPDIR" ]; then
    echo "*** Removing temporary $TMPDIR"
    rm -rf $TMPDIR
fi

cp platform/nodejs/*.js   $DES/
cp platform/nodejs/*.json $DES/
cp LICENSE.txt            $DES/

if [ "$1" = all ]; then
    echo "*** uBlock0.nodejs: Creating plain package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0.nodejs.zip -qr $(basename $DES/)/*
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uBlock0.nodejs: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0_"$1".nodejs.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** uBlock0.nodejs: Package done."
