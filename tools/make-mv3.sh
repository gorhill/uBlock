#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** uBOLite.mv3: Creating extension"

DES="dist/build/uBOLite.mv3"

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

echo "*** uBOLite.mv3: Copying common files"
cp -R src/css/fonts/* $DES/css/fonts/
cp src/css/themes/default.css $DES/css/
cp src/css/common.css $DES/css/
cp src/css/dashboard-common.css $DES/css/
cp src/css/fa-icons.css $DES/css/

cp src/js/dom.js $DES/js/
cp src/js/fa-icons.js $DES/js/
cp src/js/i18n.js $DES/js/

cp LICENSE.txt $DES/

echo "*** uBOLite.mv3: Copying mv3-specific files"
cp platform/mv3/extension/*.html $DES/
cp platform/mv3/extension/css/* $DES/css/
cp -R platform/mv3/extension/js/* $DES/js/
cp platform/mv3/extension/img/* $DES/img/
cp -R platform/mv3/extension/_locales $DES/

if [ "$1" != "quick" ]; then
    echo "*** uBOLite.mv3: Generating rulesets"
    TMPDIR=$(mktemp -d)
    mkdir -p $TMPDIR
    cp platform/mv3/extension/manifest.json $DES/
    ./tools/make-nodejs.sh $TMPDIR
    cp platform/mv3/package.json $TMPDIR/
    cp platform/mv3/*.js $TMPDIR/
    cp platform/mv3/extension/js/utils.js $TMPDIR/js/
    cp assets/assets.json $TMPDIR/
    cp -R platform/mv3/scriptlets $TMPDIR/
    mkdir -p $TMPDIR/web_accessible_resources
    cp src/web_accessible_resources/* $TMPDIR/web_accessible_resources/
    cd $TMPDIR
    node --no-warnings make-rulesets.js output=$DES
    cd - > /dev/null
    rm -rf $TMPDIR
fi

echo "*** uBOLite.mv3: extension ready"
echo "Extension location: $DES/"

if [ "$1" = "full" ]; then
    echo "*** uBOLite.mv3: Creating webstore package..."
    PACKAGENAME=uBOLite_$(jq -r .version $DES/manifest.json).mv3.zip
    TMPDIR=$(mktemp -d)
    mkdir -p $TMPDIR
    cp -R $DES/* $TMPDIR/
    cd $TMPDIR > /dev/null
    rm log.txt
    zip $PACKAGENAME -qr ./*
    cd - > /dev/null
    cp $TMPDIR/$PACKAGENAME dist/build/
    rm -rf $TMPDIR
    echo "Package location: $(pwd)/dist/build/$PACKAGENAME"
fi
