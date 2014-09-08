#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: Creating Opera web store package"
./make-chrome.sh
rm -r dist/ublock/_locales/es
rm -r dist/ublock/_locales/hu
rm -r dist/ublock/_locales/ja
rm -r dist/ublock/_locales/vi
echo "*** uBlock: Opera package done."
