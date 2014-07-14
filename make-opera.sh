#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: Creating Opera web store package"
./make-chrome.sh
rm -r dist/ublock/_locales/da
rm -r dist/ublock/_locales/pl
rm -r dist/ublock/_locales/tr
rm -r dist/ublock/_locales/uk
rm -r dist/ublock/_locales/zh_CN
echo "*** uBlock: Opera package done."
