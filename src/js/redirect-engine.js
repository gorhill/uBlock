/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

/******************************************************************************/

import {
    LineIterator,
    orphanizeString,
} from './text-utils.js';

/******************************************************************************/

// The resources referenced below are found in ./web_accessible_resources/
//
// The content of the resources which declare a `data` property will be loaded
// in memory, and converted to a suitable internal format depending on the
// type of the loaded data. The `data` property allows for manual injection
// through `+js(...)`, or for redirection to a data: URI when a redirection
// to a web accessible resource is not desirable.

const redirectableResources = new Map([
    [ '1x1.gif', {
        alias: '1x1-transparent.gif',
        data: 'blob',
    } ],
    [ '2x2.png', {
        alias: '2x2-transparent.png',
        data: 'blob',
    } ],
    [ '3x2.png', {
        alias: '3x2-transparent.png',
        data: 'blob',
    } ],
    [ '32x32.png', {
        alias: '32x32-transparent.png',
        data: 'blob',
    } ],
    [ 'addthis_widget.js', {
        alias: 'addthis.com/addthis_widget.js',
    } ],
    [ 'amazon_ads.js', {
        alias: 'amazon-adsystem.com/aax2/amzn_ads.js',
        data: 'text',
    } ],
    [ 'amazon_apstag.js', {
    } ],
    [ 'ampproject_v0.js', {
        alias: 'ampproject.org/v0.js',
    } ],  
    [ 'chartbeat.js', {
        alias: 'static.chartbeat.com/chartbeat.js',
    } ],
    [ 'click2load.html', {
        params: [ 'aliasURL', 'url' ],
    } ],
    [ 'doubleclick_instream_ad_status.js', {
        alias: 'doubleclick.net/instream/ad_status.js',
        data: 'text',
    } ],
    [ 'empty', {
        data: 'text',   // Important!
    } ],
    [ 'fingerprint2.js', {
        data: 'text',
    } ],
    [ 'fingerprint3.js', {
        data: 'text',
    } ],
    [ 'google-analytics_analytics.js', {
        alias: [
            'google-analytics.com/analytics.js',
            'googletagmanager_gtm.js',
            'googletagmanager.com/gtm.js'
        ],
        data: 'text',
    } ],
    [ 'google-analytics_cx_api.js', {
        alias: 'google-analytics.com/cx/api.js',
    } ],
    [ 'google-analytics_ga.js', {
        alias: 'google-analytics.com/ga.js',
        data: 'text',
    } ],
    [ 'google-analytics_inpage_linkid.js', {
        alias: 'google-analytics.com/inpage_linkid.js',
    } ],
    [ 'googlesyndication_adsbygoogle.js', {
        alias: 'googlesyndication.com/adsbygoogle.js',
        data: 'text',
    } ],
    [ 'googletagservices_gpt.js', {
        alias: 'googletagservices.com/gpt.js',
        data: 'text',
    } ],
    [ 'hd-main.js', {
    } ],
    [ 'ligatus_angular-tag.js', {
        alias: 'ligatus.com/*/angular-tag.js',
    } ],
    [ 'mxpnl_mixpanel.js', {
    } ],
    [ 'monkeybroker.js', {
        alias: 'd3pkae9owd2lcf.cloudfront.net/mb105.js',
    } ],
    [ 'noeval.js', {
        data: 'text',
    } ],
    [ 'noeval-silent.js', {
        alias: 'silent-noeval.js',
        data: 'text',
    } ],
    [ 'nobab.js', {
        alias: 'bab-defuser.js',
        data: 'text',
    } ],
    [ 'nobab2.js', {
        data: 'text',
    } ],
    [ 'nofab.js', {
        alias: 'fuckadblock.js-3.2.0',
        data: 'text',
    } ],
    [ 'noop-0.1s.mp3', {
        alias: [ 'noopmp3-0.1s', 'abp-resource:blank-mp3' ],
        data: 'blob',
    } ],
    [ 'noop-1s.mp4', {
        alias: 'noopmp4-1s',
        data: 'blob',
    } ],
    [ 'noop.html', {
        alias: 'noopframe',
    } ],
    [ 'noop.js', {
        alias: [ 'noopjs', 'abp-resource:blank-js' ],
        data: 'text',
    } ],
    [ 'noop.txt', {
        alias: 'nooptext',
        data: 'text',
    } ],
    [ 'noop-vmap1.0.xml', {
        alias: 'noopvmap-1.0',
        data: 'text',
    } ],
    [ 'outbrain-widget.js', {
        alias: 'widgets.outbrain.com/outbrain.js',
    } ],
    [ 'popads.js', {
        alias: 'popads.net.js',
        data: 'text',
    } ],
    [ 'popads-dummy.js', {
        data: 'text',
    } ],
    [ 'prebid-ads.js', {
        data: 'text',
    } ],
    [ 'scorecardresearch_beacon.js', {
        alias: 'scorecardresearch.com/beacon.js',
    } ],
    [ 'window.open-defuser.js', {
        alias: 'nowoif.js',
        data: 'text',
    } ],
]);

const extToMimeMap = new Map([
    [  'gif', 'image/gif' ],
    [ 'html', 'text/html' ],
    [   'js', 'application/javascript' ],
    [  'mp3', 'audio/mp3' ],
    [  'mp4', 'video/mp4' ],
    [  'png', 'image/png' ],
    [  'txt', 'text/plain' ],
    [  'xml', 'text/xml' ],
]);

const typeToMimeMap = new Map([
    [     'main_frame', 'text/html' ],
    [          'other', 'text/plain' ],
    [         'script', 'application/javascript' ],
    [     'stylesheet', 'text/css' ],
    [      'sub_frame', 'text/html' ],
    [ 'xmlhttprequest', 'text/plain' ],
]);

const validMimes = new Set(extToMimeMap.values());

const mimeFromName = function(name) {
    const match = /\.([^.]+)$/.exec(name);
    if ( match !== null ) {
        return extToMimeMap.get(match[1]);
    }
};

// vAPI.warSecret() is optional, it could be absent in some environments,
// i.e. nodejs for example. Probably the best approach is to have the
// "web_accessible_resources secret" added outside by the client of this
// module, but for now I just want to remove an obstacle to modularization.
const warSecret = typeof vAPI === 'object' && vAPI !== null
    ? vAPI.warSecret
    : ( ) => '';

/******************************************************************************/
/******************************************************************************/

const RedirectEntry = class {
    constructor() {
        this.mime = '';
        this.data = '';
        this.warURL = undefined;
        this.params = undefined;
    }

    // Prevent redirection to web accessible resources when the request is
    // of type 'xmlhttprequest', because XMLHttpRequest.responseURL would
    // cause leakage of extension id. See:
    // - https://stackoverflow.com/a/8056313
    // - https://bugzilla.mozilla.org/show_bug.cgi?id=998076
    // https://www.reddit.com/r/uBlockOrigin/comments/cpxm1v/
    //   User-supplied resources may already be base64 encoded.

    toURL(fctxt, asDataURI = false) {
        if (
            this.warURL !== undefined &&
            asDataURI !== true &&
            fctxt instanceof Object &&
            fctxt.type !== 'xmlhttprequest'
        ) {
            const params = [];
            const secret = warSecret();
            if ( secret !== '' ) { params.push(`secret=${secret}`); }
            if ( this.params !== undefined ) {
                for ( const name of this.params ) {
                    const value = fctxt[name];
                    if ( value === undefined ) { continue; }
                    params.push(`${name}=${encodeURIComponent(value)}`);
                }
            }
            let url = `${this.warURL}`;
            if ( params.length !== 0 ) {
                url += `?${params.join('&')}`;
            }
            return url;
        }
        if ( this.data === undefined ) { return; }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/701
        if ( this.data === '' ) {
            const mime = typeToMimeMap.get(fctxt.type);
            if ( mime === undefined ) { return; }
            return `data:${mime},`;
        }
        if ( this.data.startsWith('data:') === false ) {
            if ( this.mime.indexOf(';') === -1 ) {
                this.data = `data:${this.mime};base64,${btoa(this.data)}`;
            } else {
                this.data = `data:${this.mime},${this.data}`;
            }
        }
        return this.data;
    }

    toContent() {
        if ( this.data.startsWith('data:') ) {
            const pos = this.data.indexOf(',');
            const base64 = this.data.endsWith(';base64', pos);
            this.data = this.data.slice(pos + 1);
            if ( base64 ) {
                this.data = atob(this.data);
            }
        }
        return this.data;
    }

    static fromContent(mime, content) {
        const r = new RedirectEntry();
        r.mime = mime;
        r.data = content;
        return r;
    }

    static fromSelfie(selfie) {
        const r = new RedirectEntry();
        r.mime = selfie.mime;
        r.data = selfie.data;
        r.warURL = selfie.warURL;
        r.params = selfie.params;
        return r;
    }
};

/******************************************************************************/
/******************************************************************************/

const RedirectEngine = function() {
    this.aliases = new Map();
    this.resources = new Map();
    this.reset();
    this.modifyTime = Date.now();
    this.resourceNameRegister = '';
};

/******************************************************************************/

RedirectEngine.prototype.reset = function() {
};

/******************************************************************************/

RedirectEngine.prototype.freeze = function() {
};

/******************************************************************************/

RedirectEngine.prototype.tokenToURL = function(
    fctxt,
    token,
    asDataURI = false
) {
    const entry = this.resources.get(this.aliases.get(token) || token);
    if ( entry === undefined ) { return; }
    this.resourceNameRegister = token;
    return entry.toURL(fctxt, asDataURI);
};

/******************************************************************************/

RedirectEngine.prototype.hasToken = function(token) {
    if ( token === 'none' ) { return true; }
    const asDataURI = token.charCodeAt(0) === 0x25 /* '%' */;
    if ( asDataURI ) {
        token = token.slice(1);
    }
    return this.resources.get(this.aliases.get(token) || token) !== undefined;
};

/******************************************************************************/

RedirectEngine.prototype.toSelfie = async function() {
};

/******************************************************************************/

RedirectEngine.prototype.fromSelfie = async function() {
    return true;
};

/******************************************************************************/

RedirectEngine.prototype.resourceContentFromName = function(name, mime) {
    const entry = this.resources.get(this.aliases.get(name) || name);
    if ( entry === undefined ) { return; }
    if ( mime === undefined || entry.mime.startsWith(mime) ) {
        return entry.toContent();
    }
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uAssets/commit/deefe875551197d655f79cb540e62dfc17c95f42
//   Consider 'none' a reserved keyword, to be used to disable redirection.
// https://github.com/uBlockOrigin/uBlock-issues/issues/1419
//   Append newlines to raw text to ensure processing of trailing resource.

RedirectEngine.prototype.resourcesFromString = function(text) {
    const lineIter = new LineIterator(
        removeTopCommentBlock(text) + '\n\n'
    );
    const reNonEmptyLine = /\S/;
    let fields, encoded, details;

    while ( lineIter.eot() === false ) {
        const line = lineIter.next();
        if ( line.startsWith('#') ) { continue; }
        if ( line.startsWith('// ') ) { continue; }

        if ( fields === undefined ) {
            if ( line === '' ) { continue; }
            // Modern parser
            if ( line.startsWith('/// ') ) {
                const name = line.slice(4).trim();
                fields = [ name, mimeFromName(name) ];
                continue;
            }
            // Legacy parser
            const head = line.trim().split(/\s+/);
            if ( head.length !== 2 ) { continue; }
            if ( head[0] === 'none' ) { continue; }
            let pos = head[1].indexOf(';');
            if ( pos === -1 ) { pos = head[1].length; }
            if ( validMimes.has(head[1].slice(0, pos)) === false ) {
                continue;
            }
            encoded = head[1].indexOf(';') !== -1;
            fields = head;
            continue;
        }

        if ( line.startsWith('/// ') ) {
            if ( details === undefined ) {
                details = [];
            }
            const [ prop, value ] = line.slice(4).trim().split(/\s+/);
            if ( value !== undefined ) {
                details.push({ prop, value });
            }
            continue;
        }

        if ( reNonEmptyLine.test(line) ) {
            fields.push(encoded ? line.trim() : line);
            continue;
        }

        // No more data, add the resource.
        const name = this.aliases.get(fields[0]) || fields[0];
        const mime = fields[1];
        const content = orphanizeString(
            fields.slice(2).join(encoded ? '' : '\n')
        );
        this.resources.set(
            name,
            RedirectEntry.fromContent(mime, content)
        );
        if ( Array.isArray(details) ) {
            for ( const { prop, value } of details ) {
                if ( prop !== 'alias' ) { continue; }
                this.aliases.set(value, name);
            }
        }

        fields = undefined;
        details = undefined;
    }

    this.modifyTime = Date.now();
};

const removeTopCommentBlock = function(text) {
    return text.replace(/^\/\*[\S\s]+?\n\*\/\s*/, '');
};

/******************************************************************************/

RedirectEngine.prototype.loadBuiltinResources = function(fetcher) {
    this.resources = new Map();
    this.aliases = new Map();

    const fetches = [
        fetcher(
            '/assets/resources/scriptlets.js'
        ).then(result => {
            const content = result.content;
            if ( typeof content !== 'string' ) { return; }
            if ( content.length === 0 ) { return; }
            this.resourcesFromString(content);
        }),
    ];

    const store = (name, data = undefined) => {
        const details = redirectableResources.get(name);
        const entry = RedirectEntry.fromSelfie({
            mime: mimeFromName(name),
            data,
            warURL: `/web_accessible_resources/${name}`,
            params: details.params,
        });
        this.resources.set(name, entry);
        if ( details.alias === undefined ) { return; }
        if ( Array.isArray(details.alias) ) {
            for ( const alias of details.alias ) {
                this.aliases.set(alias, name);
            }
        } else {
            this.aliases.set(details.alias, name);
        }
    };

    const processBlob = (name, blob) => {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = ( ) => {
                store(name, reader.result);
                resolve();
            };
            reader.onabort = reader.onerror = ( ) => {
                resolve();
            };
            reader.readAsDataURL(blob);
        });
    };

    const processText = (name, text) => {
        store(name, removeTopCommentBlock(text));
    };

    const process = result => {
        const match = /^\/web_accessible_resources\/([^?]+)/.exec(result.url);
        if ( match === null ) { return; }
        const name = match[1];
        return result.content instanceof Blob
            ? processBlob(name, result.content)
            : processText(name, result.content);
    };

    for ( const [ name, details ] of redirectableResources ) {
        if ( typeof details.data !== 'string' ) {
            store(name);
            continue;
        }
        fetches.push(
            fetcher(`/web_accessible_resources/${name}`, {
                responseType: details.data
            }).then(
                result => process(result)
            )
        );
    }

    return Promise.all(fetches);
}; 

/******************************************************************************/

RedirectEngine.prototype.getResourceDetails = function() {
    const out = new Map([
        [ 'none', { canInject: false, canRedirect: true, aliasOf: '' } ],
    ]);
    for ( const [ name, entry ] of this.resources ) {
        out.set(name, {
            canInject: typeof entry.data === 'string',
            canRedirect: entry.warURL !== undefined,
            aliasOf: '',
        });
    }
    for ( const [ alias, name ] of this.aliases ) {
        const original = out.get(name);
        if ( original === undefined ) { continue; }
        const aliased = Object.assign({}, original);
        aliased.aliasOf = name;
        out.set(alias, aliased);
    }
    return Array.from(out).sort((a, b) => {
        return a[0].localeCompare(b[0]);
    });
};

/******************************************************************************/

const RESOURCES_SELFIE_VERSION = 6;
const RESOURCES_SELFIE_NAME = 'compiled/redirectEngine/resources';

RedirectEngine.prototype.selfieFromResources = function(storage) {
    storage.put(
        RESOURCES_SELFIE_NAME,
        JSON.stringify({
            version: RESOURCES_SELFIE_VERSION,
            aliases: Array.from(this.aliases),
            resources: Array.from(this.resources),
        })
    );
};

RedirectEngine.prototype.resourcesFromSelfie = async function(storage) {
    const result = await storage.get(RESOURCES_SELFIE_NAME);
    let selfie;
    try {
        selfie = JSON.parse(result.content);
    } catch(ex) {
    }
    if (
        selfie instanceof Object === false ||
        selfie.version !== RESOURCES_SELFIE_VERSION ||
        Array.isArray(selfie.resources) === false
    ) {
        return false;
    }
    this.aliases = new Map(selfie.aliases);
    this.resources = new Map();
    for ( const [ token, entry ] of selfie.resources ) {
        this.resources.set(token, RedirectEntry.fromSelfie(entry));
    }
    return true;
};

RedirectEngine.prototype.invalidateResourcesSelfie = function(storage) {
    storage.remove(RESOURCES_SELFIE_NAME);
};

/******************************************************************************/

const redirectEngine = new RedirectEngine();

export { redirectEngine };

/******************************************************************************/
