#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES="dist/build/uBlock0.npm"

TMPDIR=tmp
mkdir -p $TMPDIR

# Save existing npm dependencies if present so that we do not have to fetch
# them all again
if [ -d "$DES/node_modules" ]; then
    mv "$DES/node_modules" "$TMPDIR/node_modules"
fi

rm -rf $DES

./tools/make-nodejs.sh $DES

UASSETS=submodules/uAssets

# https://github.com/uBlockOrigin/uBlock-issues/issues/1664#issuecomment-888332409
mkdir -p $DES/assets/thirdparties/publicsuffix.org/list
THIRDPARTY=$UASSETS/thirdparties/publicsuffix.org
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/list/effective_tld_names.dat', 'utf8'))" \
    > $DES/assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat

mkdir -p $DES/data
THIRDPARTY=$UASSETS/thirdparties/easylist-downloads.adblockplus.org
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easylist.txt', 'utf8'))" \
    > $DES/data/easylist.json
node -pe "JSON.stringify(fs.readFileSync('$THIRDPARTY/easyprivacy.txt', 'utf8'))" \
    > $DES/data/easyprivacy.json

# Target-specific
cp    platform/npm/*.json  $DES/
cp    platform/npm/.*.json $DES/
cp    platform/npm/*.js    $DES/
cp -R platform/npm/tests   $DES/

cd $DES
npm run build
tarballname=$(npm pack 2> /dev/null)
if [ "$1" ]; then
    echo "*** uBlock0.npm: Creating versioned package..."
    mv $tarballname ../uBlock0_$1.npm.tgz
else
    echo "*** uBlock0.npm: Creating plain package..."
    mv $tarballname ../uBlock0.npm.tgz
fi
cd -

# Restore saved npm dependencies
if [ -d "$TMPDIR/node_modules" ]; then
    mv "$TMPDIR/node_modules" "$DES/node_modules"
fi

echo "*** uBlock0.npm: Package done."
