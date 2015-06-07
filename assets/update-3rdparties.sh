#!/bin/bash
#
# This script assumes a linux environment

TEMPFILE=/tmp/ublock-asset

echo "*** uBlock: updating remote assets..."

declare -A assets
assets=(
    ['thirdparties/adblock.gardar.net/is.abp.txt']='http://adblock.gardar.net/is.abp.txt'
    ['thirdparties/dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt']='https://dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/advblock.txt']='https://easylist-downloads.adblockplus.org/advblock.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/bitblock.txt']='https://easylist-downloads.adblockplus.org/bitblock.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylist.txt']='https://easylist-downloads.adblockplus.org/easylist.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylist_noelemhide.txt']='https://easylist-downloads.adblockplus.org/easylist_noelemhide.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylistchina.txt']='https://easylist-downloads.adblockplus.org/easylistchina.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylistdutch.txt']='https://easylist-downloads.adblockplus.org/easylistdutch.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylistgermany.txt']='https://easylist-downloads.adblockplus.org/easylistgermany.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easylistitaly.txt']='https://easylist-downloads.adblockplus.org/easylistitaly.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt']='https://easylist-downloads.adblockplus.org/easyprivacy.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/fanboy-annoyance.txt']='https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/fanboy-social.txt']='https://easylist-downloads.adblockplus.org/fanboy-social.txt'
    ['thirdparties/easylist-downloads.adblockplus.org/liste_fr.txt']='https://easylist-downloads.adblockplus.org/liste_fr.txt'
    ['thirdparties/notabug.org/latvian-list/adblock-latvian/raw/master/lists/latvian-list.txt']='https://notabug.org/latvian-list/adblock-latvian/raw/master/lists/latvian-list.txt'
    ['thirdparties/home.fredfiber.no/langsholt/adblock.txt']='http://home.fredfiber.no/langsholt/adblock.txt'
    ['thirdparties/hosts-file.net/ad-servers']='http://hosts-file.net/.%5Cad_servers.txt'
    ['thirdparties/liste-ar-adblock.googlecode.com/hg/Liste_AR.txt']='https://liste-ar-adblock.googlecode.com/hg/Liste_AR.txt'
    ['thirdparties/margevicius.lt/easylistlithuania.txt']='http://margevicius.lt/easylistlithuania.txt'
    ['thirdparties/mirror1.malwaredomains.com/files/immortal_domains.txt']='http://mirror1.malwaredomains.com/files/immortal_domains.txt'
    ['thirdparties/mirror1.malwaredomains.com/files/justdomains']='http://mirror1.malwaredomains.com/files/justdomains'
    ['thirdparties/pgl.yoyo.org/as/serverlist']='http://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&startdate%5Bday%5D=&startdate%5Bmonth%5D=&startdate%5Byear%5D=&mimetype=plaintext'
    ['thirdparties/publicsuffix.org/list/effective_tld_names.dat']='https://publicsuffix.org/list/effective_tld_names.dat'
    ['thirdparties/raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt']='https://raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt'
    ['thirdparties/raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt']='https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt'
    ['thirdparties/raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt']='https://raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt'
    ['thirdparties/raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt']='https://raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt'
    ['thirdparties/raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt']='https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt'
    ['thirdparties/someonewhocares.org/hosts/hosts']='http://someonewhocares.org/hosts/hosts'
    ['thirdparties/spam404bl.com/spam404scamlist.txt']='https://spam404bl.com/spam404scamlist.txt'
    ['thirdparties/stanev.org/abp/adblock_bg.txt']='http://stanev.org/abp/adblock_bg.txt'
    ['thirdparties/winhelp2002.mvps.org/hosts.txt']='http://winhelp2002.mvps.org/hosts.txt'
    ['thirdparties/www.fanboy.co.nz/enhancedstats.txt']='https://www.fanboy.co.nz/enhancedstats.txt'
    ['thirdparties/www.fanboy.co.nz/fanboy-antifacebook.txt']='https://www.fanboy.co.nz/fanboy-antifacebook.txt'
    ['thirdparties/www.fanboy.co.nz/fanboy-korean.txt']='https://www.fanboy.co.nz/fanboy-korean.txt'
    ['thirdparties/www.fanboy.co.nz/fanboy-swedish.txt']='https://www.fanboy.co.nz/fanboy-swedish.txt'
    ['thirdparties/www.fanboy.co.nz/fanboy-ultimate.txt']='https://www.fanboy.co.nz/r/fanboy-ultimate.txt'
    ['thirdparties/www.fanboy.co.nz/fanboy-vietnam.txt']='https://www.fanboy.co.nz/fanboy-vietnam.txt'
    ['thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt']='http://www.malwaredomainlist.com/hostslist/hosts.txt'
    ['thirdparties/www.void.gr/kargig/void-gr-filters.txt']='https://www.void.gr/kargig/void-gr-filters.txt'
    ['thirdparties/www.zoso.ro/pages/rolist.txt']='http://www.zoso.ro/pages/rolist.txt'
#    ['thirdparties/adblock.schack.dk/block.txt']='http://adblock.schack.dk/block.txt'
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
