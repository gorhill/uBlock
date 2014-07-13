#!/bin/bash
#
# This script assumes a linux environment

TEMPFILE=/tmp/httpsb-asset

echo "*** uBlock: updating remote assets..."

THIRDPARTY_REMOTEURLS=(
    'http://mirror1.malwaredomains.com/files/immortal_domains.txt'
    'http://mirror1.malwaredomains.com/files/justdomains'
    'http://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&startdate%5Bday%5D=&startdate%5Bmonth%5D=&startdate%5Byear%5D=&mimetype=plaintext'
    'http://www.malwaredomainlist.com/hostslist/hosts.txt'
    'http://hosts-file.net/.%5Cad_servers.txt'
    'http://someonewhocares.org/hosts/hosts'
    'http://winhelp2002.mvps.org/hosts.txt'
    'http://spam404bl.com/spam404scamlist.txt'    
    'https://publicsuffix.org/list/effective_tld_names.dat'
    'https://easylist-downloads.adblockplus.org/easylist.txt'
    'https://easylist-downloads.adblockplus.org/easylist_noelemhide.txt'
    'https://easylist-downloads.adblockplus.org/easyprivacy.txt'
    'https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt'
    'https://www.fanboy.co.nz/enhancedstats.txt'
    'https://www.fanboy.co.nz/fanboy-antifacebook.txt'
    'https://raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt'
    'https://easylist-downloads.adblockplus.org/easylistgermany.txt'
    'http://www.hufilter.hu/hufilter.txt'
    'https://easylist-downloads.adblockplus.org/easylistitaly.txt'
    'https://dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt'
    'https://easylist-downloads.adblockplus.org/easylistdutch.txt'
    'https://easylist-downloads.adblockplus.org/liste_fr.txt'
    'https://easylist-downloads.adblockplus.org/advblock.txt'
    'https://easylist-downloads.adblockplus.org/bitblock.txt'
    'https://easylist-downloads.adblockplus.org/easylistchina.txt'
    'https://cjxlist1.googlecode.com/svn/cjxlist.txt'
    'http://adblock-chinalist.googlecode.com/svn/trunk/adblock.txt'
    'https://adblock-plus-japanese-filter.googlecode.com/hg/abp_jp.txt'
    'http://margevicius.lt/AdBlockPlusLithuania.txt'
    'http://stanev.org/abp/adblock_bg.txt'
    'https://indonesianadblockrules.googlecode.com/hg/subscriptions/abpindo.txt'
    'https://liste-ar-adblock.googlecode.com/hg/Liste_AR.txt'
    'https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt'
    'https://raw.githubusercontent.com/adblockpolska/Adblock_PL_List/master/adblock_polska.txt'
    'https://raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt'
    'http://download.wiltteri.net/wiltteri.txt'
    'http://home.fredfiber.no/langsholt/adblock.txt'
    'https://www.fanboy.co.nz/fanboy-swedish.txt'
    'http://adblock.schack.dk/block.txt'
    'http://adblock.gardar.net/is.abp.txt'
    'https://www.void.gr/kargig/void-gr-filters.txt'
    'http://abp.mozilla-hispano.org/nauscopio/filtros.txt'
    )

THIRDPARTY_LOCALURLS=(
    'thirdparties/mirror1.malwaredomains.com/files/immortal_domains.txt'
    'thirdparties/mirror1.malwaredomains.com/files/justdomains'
    'thirdparties/pgl.yoyo.org/as/serverlist'
    'thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt'
    'thirdparties/hosts-file.net/ad-servers'
    'thirdparties/someonewhocares.org/hosts/hosts'
    'thirdparties/winhelp2002.mvps.org/hosts.txt'
    'thirdparties/spam404bl.com/spam404scamlist.txt'    
    'thirdparties/publicsuffix.org/list/effective_tld_names.dat'
    'thirdparties/easylist-downloads.adblockplus.org/easylist.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easylist_noelemhide.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt'
    'thirdparties/easylist-downloads.adblockplus.org/fanboy-annoyance.txt'
    'thirdparties/www.fanboy.co.nz/enhancedstats.txt'
    'thirdparties/www.fanboy.co.nz/fanboy-antifacebook.txt'
    'thirdparties/raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easylistgermany.txt'
    'thirdparties/www.hufilter.hu/hufilter.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easylistitaly.txt'
    'thirdparties/dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easylistdutch.txt'
    'thirdparties/easylist-downloads.adblockplus.org/liste_fr.txt'
    'thirdparties/easylist-downloads.adblockplus.org/advblock.txt'
    'thirdparties/easylist-downloads.adblockplus.org/bitblock.txt'
    'thirdparties/easylist-downloads.adblockplus.org/easylistchina.txt'
    'thirdparties/cjxlist1.googlecode.com/svn/cjxlist.txt'
    'thirdparties/adblock-chinalist.googlecode.com/svn/trunk/adblock.txt'
    'thirdparties/adblock-plus-japanese-filter.googlecode.com/hg/abp_jp.txt'
    'thirdparties/margevicius.lt/AdBlockPlusLithuania.txt'
    'thirdparties/stanev.org/abp/adblock_bg.txt'
    'thirdparties/indonesianadblockrules.googlecode.com/hg/subscriptions/abpindo.txt'
    'thirdparties/liste-ar-adblock.googlecode.com/hg/Liste_AR.txt'
    'thirdparties/raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt'
    'thirdparties/raw.githubusercontent.com/adblockpolska/Adblock_PL_List/master/adblock_polska.txt'
    'thirdparties/raw.githubusercontent.com/AdBlockPlusIsrael/EasyListHebrew/master/EasyListHebrew.txt'
    'thirdparties/download.wiltteri.net/wiltteri.txt'
    'thirdparties/home.fredfiber.no/langsholt/adblock.txt'
    'thirdparties/www.fanboy.co.nz/fanboy-swedish.txt'
    'thirdparties/adblock.schack.dk/block.txt'
    'thirdparties/adblock.gardar.net/is.abp.txt'
    'thirdparties/www.void.gr/kargig/void-gr-filters.txt'
    'thirdparties/abp.mozilla-hispano.org/nauscopio/filtros.txt'
    )

ENTRY_INDEX=0
for THIRDPARTY_REMOTEURL in ${THIRDPARTY_REMOTEURLS[@]}; do
    THIRDPARTY_LOCALURL=${THIRDPARTY_LOCALURLS[ENTRY_INDEX]}
    echo "*** Downloading" $THIRDPARTY_REMOTEURL
    if wget -q -T 30 -O $TEMPFILE -- $THIRDPARTY_REMOTEURL; then
        if [ -s $TEMPFILE ]; then
            if ! cmp -s $TEMPFILE $THIRDPARTY_LOCALURL; then
                echo "    New version found: $THIRDPARTY_LOCALURL"
                if [ "$1" != "dry" ]; then
                    mv $TEMPFILE $THIRDPARTY_LOCALURL
                fi
            fi
        fi
    fi
    let ENTRY_INDEX+=1
done

