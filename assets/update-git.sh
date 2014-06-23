#!/bin/bash
#
# This script assumes a linux environment

echo "*** HTTP Switchboard: git adding changed assets..."
git add --update --ignore-removal --ignore-errors ./*
echo "*** HTTP Switchboard: git committing assets..."
git commit -m 'update of third-party assets'
echo "*** HTTP Switchboard: git pushing assets to remote master..."
git push origin master

echo "*** HTTP Switchboard: git done."

