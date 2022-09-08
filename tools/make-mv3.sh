#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** uBlock0.mv3: Creating extension"

DES="dist/build/uBlock0.mv3"

if [ "$1" != "quick" ]; then
    rm -rf $DES
fi

mkdir -p $DES
cd $DES
DES=$(pwd)
cd - > /dev/null

mkdir -p $DES/css/fonts
mkdir -p $DES/js
mkdir -p $DES/img

echo "*** uBlock0.mv3: Copying common files"
cp -R src/css/fonts/* $DES/css/fonts/
cp src/css/themes/default.css $DES/css/
cp src/css/common.css $DES/css/
cp src/css/fa-icons.css $DES/css/
cp src/js/fa-icons.js $DES/js/

cp LICENSE.txt $DES/

echo "*** uBlock0.mv3: Copying mv3-specific files"
cp platform/mv3/extension/*.html $DES/
cp platform/mv3/extension/css/* $DES/css/
cp platform/mv3/extension/js/* $DES/js/
cp platform/mv3/extension/img/* $DES/img/

if [ "$1" != "quick" ]; then
    echo "*** uBlock0.mv3: Generating rulesets"
    TMPDIR=$(mktemp -d)
    mkdir -p $TMPDIR
    cp platform/mv3/extension/manifest.json $DES/
    ./tools/make-nodejs.sh $TMPDIR
    cp platform/mv3/package.json $TMPDIR/
    cp platform/mv3/*.js $TMPDIR/
    cd $TMPDIR
    node --no-warnings make-rulesets.js output=$DES quick=$QUICK
    cd - > /dev/null
    rm -rf $TMPDIR
fi

echo "*** uBlock0.mv3: extension ready"
echo "Extension location: $DES/"

if [ "$1" = "full" ]; then
    echo "*** uBlock0.mv3: Creating webstore package..."
    PACKAGENAME=uBlock0_$(jq -r .version $DES/manifest.json).mv3.zip
    TMPDIR=$(mktemp -d)
    mkdir -p $TMPDIR
    cp -R $DES/* $TMPDIR/
    cd $TMPDIR > /dev/null
    rm log.txt
    zip $PACKAGENAME -r ./*
    cd - > /dev/null
    cp $TMPDIR/$PACKAGENAME dist/build/
    rm -rf $TMPDIR
    echo "Package location: $(pwd)/dist/build/$PACKAGENAME"
fi
