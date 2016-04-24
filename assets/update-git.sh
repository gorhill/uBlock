#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** AdNauseam: git adding changed assets..."
git add --update --ignore-removal --ignore-errors ./*
echo "*** AdNauseam: git committing assets..."
git commit -m 'update of third-party assets'
echo "*** AdNauseam: git pushing assets to remote master..."
git push origin master

echo "*** AdNauseam: git done."
