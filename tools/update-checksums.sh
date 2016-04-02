#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uBlock: generating checksums.txt file..."

truncate -s 0 assets/checksums.txt

echo `md5sum assets/ublock/filter-lists.json` >> assets/checksums.txt

filters=(
    '../uAssets/filters/badware.txt'
    '../uAssets/filters/experimental.txt'
    '../uAssets/filters/filters.txt'
    '../uAssets/filters/privacy.txt'
    '../uAssets/filters/resources.txt'
    '../uAssets/filters/unbreak.txt'
)
for repoPath in "${filters[@]}"; do
    echo `md5sum $repoPath` | sed 's/\.\.\/uAssets\/filters/assets\/ublock/' >> assets/checksums.txt
done

thirdparties=(
    '../uAssets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt'
    '../uAssets/thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt'
    '../uAssets/thirdparties/mirror1.malwaredomains.com/files/justdomains'
    '../uAssets/thirdparties/pgl.yoyo.org/as/serverlist'
    '../uAssets/thirdparties/publicsuffix.org/list/effective_tld_names.dat'
    '../uAssets/thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt'
)
for repoPath in "${thirdparties[@]}"; do
    echo `md5sum $repoPath` | sed 's/\.\.\/uAssets\/thirdparties/assets\/thirdparties/' >> assets/checksums.txt
done

echo "*** uBlock: checksums updated."

git status assets/
