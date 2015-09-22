#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock: git adding changed assets..."
git add --update --ignore-removal --ignore-errors ./*
echo "*** uBlock: git committing assets..."
git commit -m 'update of third-party assets'
echo "*** uBlock: git pushing assets to remote master..."
git push origin master

echo "*** uBlock: git done."

