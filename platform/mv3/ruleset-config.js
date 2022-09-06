/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

'use strict';

export default [
    {
        id: 'default',
        name: 'Default ruleset',
        enabled: true,
        paths: [
        ],
        urls: [
            'https://ublockorigin.github.io/uAssets/filters/badware.txt',
            'https://ublockorigin.github.io/uAssets/filters/filters.txt',
            'https://ublockorigin.github.io/uAssets/filters/filters-2020.txt',
            'https://ublockorigin.github.io/uAssets/filters/filters-2021.txt',
            'https://ublockorigin.github.io/uAssets/filters/filters-2022.txt',
            'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
            'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
            'https://ublockorigin.github.io/uAssets/filters/resource-abuse.txt',
            'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
            'https://easylist.to/easylist/easylist.txt',
            'https://easylist.to/easylist/easyprivacy.txt',
            'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
            'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext',
        ]
    },
    {
        id: 'DEU-0',
        name: 'DEU: EasyList Germany',
        enabled: false,
        paths: [
        ],
        urls: [
            'https://easylist.to/easylistgermany/easylistgermany.txt',
        ]
    },
    {
        id: 'RUS-0',
        name: 'RUS: RU AdList',
        enabled: false,
        paths: [
        ],
        urls: [
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/adservers.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/first_level.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/general_block.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/specific_antisocial.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/specific_block.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/specific_special.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/thirdparty.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/whitelist.txt',
            'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/AWRL-non-sync.txt',
        ]
    },
];
