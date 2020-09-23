/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

/* global CodeMirror */

'use strict';

CodeMirror.defineMode('ubo-dynamic-filtering', ( ) => {

    const validSwitches = new Set([
        'no-strict-blocking:',
        'no-popups:',
        'no-cosmetic-filtering:',
        'no-remote-fonts:',
        'no-large-media:',
        'no-csp-reports:',
        'no-scripting:',
    ]);
    const validSwitcheStates = new Set([
        'true',
        'false',
    ]);
    const validHnRuleTypes = new Set([
        '*',
        '3p',
        'image',
        'inline-script',
        '1p-script',
        '3p-script',
        '3p-frame',
    ]);
    const invalidURLRuleTypes = new Set([
        'doc',
        'main_frame',
    ]);
    const validActions = new Set([
        'block',
        'allow',
        'noop',
    ]);
    const hnValidator = new URL(self.location.href);
    const reBadHn = /[%]|^\.|\.$/;
    const slices = [];
    let sliceIndex = 0;
    const tokens = [];
    let tokenIndex = 0;

    const isValidHostname = hnin => {
        if ( hnin === '*' ) { return true; }
        hnValidator.hostname = '_';
        try {
            hnValidator.hostname = hnin;
        } catch(_) {
            return false;
        }
        const hnout = hnValidator.hostname;
        return hnout !== '_' && hnout !== '' && reBadHn.test(hnout) === false;
    };

    const isSwitchRule = ( ) => {
        const token = tokens[0];
        return token.charCodeAt(token.length-1) === 0x3A /* ':' */;
    };

    const isURLRule = ( ) => {
        return tokens[1].indexOf('://') > 0;
    };

    const skipToEnd = (stream, style = null) => {
        stream.skipToEnd();
        return style;
    };

    const token = function(stream) {
        if ( stream.sol() ) {
            if ( stream.string === '...' ) {
                return stream.skipToEnd(stream);
            }
            slices.length = 0;
            tokens.length = 0;
            const reTokens = /\S+/g;
            for (;;) {
                const lastIndex = reTokens.lastIndex;
                const match = reTokens.exec(stream.string);
                if ( match === null ) { break; }
                const l = match.index;
                const r = reTokens.lastIndex;
                if ( l !== lastIndex ) {
                    slices.push({ t: false, l: lastIndex, r: l });
                }
                slices.push({ t: true, l, r });
                tokens.push(stream.string.slice(l, r));
            }
            sliceIndex = tokenIndex = 0;
        }
        if ( sliceIndex >= slices.length ) {
            return stream.skipToEnd(stream);
        }
        const slice = slices[sliceIndex++];
        stream.pos = slice.r;
        if ( slice.t !== true ) { return null; }
        const token = tokens[tokenIndex++];
        // Field 1: per-site switch or hostname
        if ( tokenIndex === 1 ) {
            if ( isSwitchRule(token) ) {
                if ( validSwitches.has(token) === false ) {
                    return skipToEnd(stream, 'error');
                }
                if ( this.sortType === 0 ) { return 'sortkey'; }
                return null;
            }
            if ( isValidHostname(token) === false ) {
                return skipToEnd(stream, 'error');
            }
            if ( this.sortType === 1 ) { return 'sortkey'; }
            return null;
        }
        // Field 2: hostname or url
        if ( tokenIndex === 2 ) {
            if ( isSwitchRule(tokens[0]) ) {
                if ( isValidHostname(token) === false  ) {
                    return skipToEnd(stream, 'error');
                }
                if ( this.sortType === 1 ) { return 'sortkey'; }
            }
            if (
                isValidHostname(token) === false &&
                isURLRule(token) === false
            ) {
                return skipToEnd(stream, 'error');
            }
            if ( this.sortType === 2 ) { return 'sortkey'; }
            return null;
        }
        // Field 3
        if ( tokenIndex === 3 ) {
            // Switch rule
            if ( isSwitchRule(tokens[0]) ) {
                if ( validSwitcheStates.has(token) === false ) {
                    return skipToEnd(stream, 'error');
                }
                if ( token === 'true' ) { return 'blockrule'; }
                if ( token === 'false' ) { return 'allowrule'; }
                return null;
            }
            // Hostname rule
            if ( isURLRule(tokens[1]) === false ) {
                if (
                    tokens[1] !== '*' && token !== '*' ||
                    tokens[1] === '*' && validHnRuleTypes.has(token) === false
                ) {
                    return skipToEnd(stream, 'error');
                }
                return null;
            }
            // URL rule
            if (
                /[^a-z_-]/.test(token) && token !== '*' ||
                invalidURLRuleTypes.has(token)
            ) {
                return skipToEnd(stream, 'error');
            }
            return null;
        }
        // Field 4
        if ( tokenIndex === 4 ) {
            if (
                isSwitchRule(tokens[0]) ||
                validActions.has(token) === false
            ) {
                return skipToEnd(stream, 'error');
            }
            if ( token === 'allow' ) { return 'allowrule'; }
            if ( token === 'block' ) { return 'blockrule'; }
            return 'nooprule';
        }
        return skipToEnd(stream);
    };

    return { token, sortType: 1 };
});
