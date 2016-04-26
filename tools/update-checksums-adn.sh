#!/usr/bin/env bash
#
# This script assumes an OS X environment with truncate and md5sum installed

echo "*** AdNauseam: appending to checksums.txt file..."

ENTRY=assets/ublock/adnauseam.txt
echo `md5sum -q $ENTRY` $ENTRY >> assets/checksums.txt

git status assets/
