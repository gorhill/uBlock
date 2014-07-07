#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: Creating Opera web store package"
./make-chrome.sh
rm -r dist/ublock/_locales/ru
rm -r dist/ublock/_locales/zh_CN
echo "*** uBlock: Opera package done."
