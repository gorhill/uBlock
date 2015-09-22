#!/usr/bin/env bash
#
# This script assumes a linux environment

if [ -z "$1" ]; then
    echo "*** uBlock: invalid path."
    exit 1
fi

echo "*** uBlock: zeroing remote assets..."

TARGETS=(
    "adblock.gardar.net/is.abp.txt"
    "adblock.schack.dk/block.txt"
    "dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt"
    "easylist-downloads.adblockplus.org/advblock.txt"
    "easylist-downloads.adblockplus.org/bitblock.txt"
    "easylist-downloads.adblockplus.org/easylist_noelemhide.txt"
    "easylist-downloads.adblockplus.org/easylistchina.txt"
    "easylist-downloads.adblockplus.org/easylistdutch.txt"
    "easylist-downloads.adblockplus.org/easylistgermany.txt"
    "easylist-downloads.adblockplus.org/easylistitaly.txt"
    "easylist-downloads.adblockplus.org/fanboy-annoyance.txt"
    "easylist-downloads.adblockplus.org/fanboy-social.txt"
    "easylist-downloads.adblockplus.org/liste_fr.txt"
    "gitorious.org/adblock-latvian/adblock-latvian/raw/master_lists/latvian-list.txt"
    "home.fredfiber.no/langsholt/adblock.txt"
    "hosts-file.net/ad-servers"
    "liste-ar-adblock.googlecode.com/hg/Liste_AR.txt"
    "margevicius.lt/easylistlithuania.txt"
    "mirror1.malwaredomains.com/files/immortal_domains.txt"
    "raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt"
    "raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt"
    "raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt"
    "raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt"
    "raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt"
    "someonewhocares.org/hosts/hosts"
    "spam404bl.com/spam404scamlist.txt"
    "stanev.org/abp/adblock_bg.txt"
    "winhelp2002.mvps.org/hosts.txt"
    "www.fanboy.co.nz/enhancedstats.txt"
    "www.fanboy.co.nz/fanboy-antifacebook.txt"
    "www.fanboy.co.nz/fanboy-korean.txt"
    "www.fanboy.co.nz/fanboy-swedish.txt"
    "www.fanboy.co.nz/fanboy-ultimate.txt"
    "www.fanboy.co.nz/fanboy-vietnam.txt"
    "www.void.gr/kargig/void-gr-filters.txt"
    "www.zoso.ro/pages/rolist.txt"
)

for TARGET in "${TARGETS[@]}"; do
    cat /dev/null >| "$1/assets/thirdparties/$TARGET"
done
