#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock: Creating web store package"
echo "*** uBlock: Copying files"
cp -R css dist/ublock/
cp -R img dist/ublock/
cp -R js dist/ublock/
cp -R lib dist/ublock/
cp -R _locales dist/ublock/
cp *.html dist/ublock/
cp *.txt dist/ublock/
cp manifest.json dist/ublock/
echo "*** uBlock: Package done."
