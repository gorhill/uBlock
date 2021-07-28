#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

mkdir $DES/thirdparties

# Use existing uAssets, or git-clone a temporary one
if [ -d "../uAssets" ]; then
    UASSETS=../uAssets
else
    echo "*** ../uAssets not present, git-cloning..."
    TMPDIR=$(mktemp -d)
    UASSETS=$TMPDIR/uAssets
    git clone --depth=1 https://github.com/uBlockOrigin/uAssets.git $UASSETS
fi

cp -R $UASSETS/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R $UASSETS/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R $UASSETS/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R $UASSETS/thirdparties/urlhaus-filter                     $DES/thirdparties/

mkdir $DES/ublock
cp -R $UASSETS/filters/* $DES/ublock/
# Optional filter lists: do not include in package
rm    $DES/ublock/annoyances.txt

# Remove temporary git-clone uAssets
if [ -n "$TMPDIR" ]; then
    echo "*** Removing temporary $TMPDIR"
    rm -rf $TMPDIR
fi
