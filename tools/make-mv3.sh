#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** uBlock0.mv3: Creating extension"

DES="dist/build/uBlock0.mv3"
rm -rf $DES
mkdir -p $DES
cd $DES
DES=$(pwd)
cd - > /dev/null
TMPDIR=$(mktemp -d)
mkdir -p $TMPDIR

echo "*** uBlock0.mv3: Copying mv3-specific files"
cp -R platform/mv3/extension/* $DES/

echo "*** uBlock0.mv3: Copying common files"
cp LICENSE.txt $DES/

echo "*** uBlock0.mv3: Generating rulesets"
./tools/make-nodejs.sh $TMPDIR
cp platform/mv3/package.json $TMPDIR/
cp platform/mv3/*.js $TMPDIR/
cd $TMPDIR
node --no-warnings make-rulesets.js output=$DES
cd - > /dev/null
rm -rf $TMPDIR

echo "*** uBlock0.mv3: extension ready"
echo "Extension location: $DES/"

if [ "$1" = all ]; then
    echo "*** uBlock0.mv3: Creating webstore package..."
    pushd $(dirname $DES/) > /dev/null
    zip uBlock0.mv3.zip -qr $(basename $DES/)/*
    echo "Package location: $(pwd)/uBlock0.mv3.zip" 
    popd > /dev/null
fi
