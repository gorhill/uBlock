#!/usr/bin/env bash
#
# This script assumes a linux environment

TEMPFILE=/tmp/httpsb-asset

echo "*** uBlock: updating remote assets..."

declare -A assets
assets=(
    ['thirdparties/mirror1.malwaredomains.com/files/immortal_domains.txt']='http://mirror1.malwaredomains.com/files/immortal_domains.txt'
    ['thirdparties/mirror1.malwaredomains.com/files/justdomains']='http://mirror1.malwaredomains.com/files/justdomains'
    ['thirdparties/publicsuffix.org/list/effective_tld_names.dat']='https://publicsuffix.org/list/effective_tld_names.dat'
)

for i in "${!assets[@]}"; do
    localURL="$i"
    remoteURL="${assets[$i]}"
    echo "*** Downloading ${remoteURL}"
    if wget -q -T 30 -O $TEMPFILE -- $remoteURL; then
        if [ -s $TEMPFILE ]; then
            if ! cmp -s $TEMPFILE $localURL; then
                echo "    New version found: ${localURL}"
                if [ "$1" != "dry" ]; then
                    mv $TEMPFILE $localURL
                fi
            fi
        fi
    fi
done
