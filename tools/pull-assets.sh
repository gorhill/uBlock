#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e

DES=dist/build/uAssets

echo "*** Pull assets from remote into $DES"
git clone --depth 1 --branch master https://github.com/uBlockOrigin/uAssets $DES/main
git clone --depth 1 --branch gh-pages https://github.com/uBlockOrigin/uAssets $DES/prod
