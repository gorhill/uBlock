#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

echo "*** uBOLite.edge: Creating web store package"

DES=dist/build/uBOLite.edge
rm -rf $DES
mkdir -p $DES

echo "*** uBOLite.edge: Copying reference chromium-based files"
cp -R dist/build/uBOLite.chromium/* $DES/

# Edge store requires that all DNR rulesets are at the root of the package
# https://learn.microsoft.com/answers/questions/918426/cant-update-extension-with-declarative-net-request
echo "*** uBOLite.edge: Modify reference implementation for Edge compatibility"
mv $DES/rulesets/main/* $DES/
rmdir $DES/rulesets/main
# Patch manifest.json
node tools/make-edge.mjs

echo "*** uBOLite.edge: Package done."
