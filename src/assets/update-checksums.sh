#!/bin/bash
#
# This script assumes a linux environment

echo "*** uBlock: generating checksums.txt file..."
pushd ..
truncate -s 0 assets/checksums.txt
LIST="$(find assets/ublock assets/thirdparties -type f)"
for ENTRY in $LIST; do
    echo `md5sum $ENTRY` >> assets/checksums.txt
done
popd

echo "*** uBlock: checksums updated."

