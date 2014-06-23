#!/bin/bash
#
# This script assumes a linux environment

echo "*** HTTP Switchboard: generating checksums.txt file..."
pushd ..
truncate -s 0 assets/checksums.txt
LIST="$(find assets/httpsb assets/thirdparties -type f)"
for ENTRY in $LIST; do
    echo `md5sum $ENTRY` >> assets/checksums.txt
done
popd

echo "*** HTTP Switchboard: checksums updated."

