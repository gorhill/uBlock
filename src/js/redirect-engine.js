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

µBlock.redirectEngine = (( ) => {

/******************************************************************************/
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
    } ],
    [ 'ampproject_v0.js', {
        alias: 'ampproject.org/v0.js',
    } ],
    [ 'chartbeat.js', {
        alias: 'static.chartbeat.com/chartbeat.js',
    } ],
    [ 'disqus_embed.js', {
        alias: 'disqus.com/embed.js',
    } ],
    [ 'disqus_forums_embed.js', {
        alias: 'disqus.com/forums/*/embed.js',
    } ],
    [ 'doubleclick_instream_ad_status.js', {
        alias: 'doubleclick.net/instream/ad_status.js',
    } ],
    [ 'empty', {
        data: 'text',   // Important!
    } ],
    [ 'google-analytics_analytics.js', {
        alias: 'google-analytics.com/analytics.js',
    } ],
    [ 'google-analytics_cx_api.js', {
        alias: 'google-analytics.com/cx/api.js',
    } ],
    [ 'google-analytics_ga.js', {
        alias: 'google-analytics.com/ga.js',
    } ],
    [ 'google-analytics_inpage_linkid.js', {
        alias: 'google-analytics.com/inpage_linkid.js',
    } ],
    [ 'googlesyndication_adsbygoogle.js', {
        alias: 'googlesyndication.com/adsbygoogle.js',
    } ],
    [ 'googletagmanager_gtm.js', {
        alias: 'googletagmanager.com/gtm.js',
    } ],
    [ 'googletagservices_gpt.js', {
        alias: 'googletagservices.com/gpt.js',
    } ],
    [ 'hd-main.js', {
    } ],
    [ 'ligatus_angular-tag.js', {
        alias: 'ligatus.com/*/angular-tag.js',
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
    [ 'nofab.js', {
        alias: 'fuckadblock.js-3.2.0',
        data: 'text',
    } ],
    [ 'noop-0.1s.mp3', {
        alias: 'noopmp3-0.1s',
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
        alias: 'noopjs',
        data: 'text',
    } ],
    [ 'noop.txt', {
        alias: 'nooptext',
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
    [ 'scorecardresearch_beacon.js', {
        alias: 'scorecardresearch.com/beacon.js',
    } ],
    [ 'window.open-defuser.js', {
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

/******************************************************************************/
/******************************************************************************/

const RedirectEntry = class {
    constructor() {
        this.mime = '';
        this.data = '';
        this.warURL = undefined;
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
            return `${this.warURL}${vAPI.warSecret()}`;
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
        return r;
    }
};

/******************************************************************************/
/******************************************************************************/

const RedirectEngine = function() {
    this.aliases = new Map();
    this.resources = new Map();
    this.reset();
    this.resourceNameRegister = '';
};

/******************************************************************************/

RedirectEngine.prototype.reset = function() {
    this.rules = new Map();
    this.ruleSources = new Set();
    this.ruleDestinations = new Set();
    this.resetCache();
    this.modifyTime = Date.now();
};

RedirectEngine.prototype.resetCache = function() {
    this._src = '';
    this._srcAll = [ '*' ];
    this._des = '';
    this._desAll = [ '*' ];
};

/******************************************************************************/

RedirectEngine.prototype.freeze = function() {
};

/******************************************************************************/

RedirectEngine.prototype.toBroaderHostname = function(hostname) {
    const pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' ? '*' : '';
};

/******************************************************************************/

RedirectEngine.prototype.decomposeHostname = function(hn, dict, out) {
    let i = 0;
    for (;;) {
        if ( dict.has(hn) ) {
            out[i] = hn; i += 1;
        }
        hn = this.toBroaderHostname(hn);
        if ( hn === '' ) { break; }
    }
    out.length = i;
};

/******************************************************************************/

RedirectEngine.prototype.lookup = function(fctxt) {
    const src = fctxt.getDocHostname();
    const des = fctxt.getHostname();
    const type = fctxt.type;
    if ( src !== this._src ) {
        this._src = src;
        this.decomposeHostname(src, this.ruleSources, this._srcAll);
    }
    if ( this._srcAll.length === 0 ) { return; }
    if ( des !== this._des ) {
        this._des = des;
        this.decomposeHostname(des, this.ruleDestinations, this._desAll);
    }
    if ( this._desAll.length === 0 ) { return; }
    const reqURL = fctxt.url;
    for ( const src of this._srcAll ) {
        for ( const des of this._desAll ) {
            let entries = this.rules.get(`${src} ${des} ${type}`);
            if ( entries !== undefined ) {
                const rule = this.lookupRule(entries, reqURL);
                if ( rule !== undefined ) { return rule; }
            }
            entries = this.rules.get(`${src} ${des} *`);
            if ( entries !== undefined ) {
                const rule = this.lookupRule(entries, reqURL);
                if ( rule !== undefined ) { return rule; }
            }
        }
    }
};

RedirectEngine.prototype.lookupRule = function(entries, reqURL) {
    for ( const entry of entries ) {
        if ( entry.pat instanceof RegExp === false ) {
            entry.pat = new RegExp(entry.pat, 'i');
        }
        if ( entry.pat.test(reqURL) ) {
            return entry;
        }
    }
};

/******************************************************************************/

RedirectEngine.prototype.toURL = function(fctxt) {
    const rule = this.lookup(fctxt);
    if ( rule === undefined ) { return; }
    let token = this.resourceNameRegister = rule.tok;
    const asDataURI = token.charCodeAt(0) === 0x25 /* '%' */;
    if ( asDataURI ) {
        token = token.slice(1);
    }
    const entry = this.resources.get(this.aliases.get(token) || token);
    if ( entry !== undefined ) {
        return entry.toURL(fctxt, asDataURI);
    }
};

/******************************************************************************/

RedirectEngine.prototype.addRule = function(src, des, type, pattern, redirect) {
    this.ruleSources.add(src);
    this.ruleDestinations.add(des);
    const key = `${src} ${des} ${type}`,
        entries = this.rules.get(key);
    if ( entries === undefined ) {
        this.rules.set(key, [ { tok: redirect, pat: pattern } ]);
        this.modifyTime = Date.now();
        return;
    }
    let entry;
    for ( var i = 0, n = entries.length; i < n; i++ ) {
        entry = entries[i];
        if ( redirect === entry.tok ) { break; }
    }
    if ( i === n ) {
        entries.push({ tok: redirect, pat: pattern });
        return;
    }
    let p = entry.pat;
    if ( p instanceof RegExp ) {
        p = p.source;
    }
    // Duplicate?
    let pos = p.indexOf(pattern);
    if ( pos !== -1 ) {
        if ( pos === 0 || p.charAt(pos - 1) === '|' ) {
            pos += pattern.length;
            if ( pos === p.length || p.charAt(pos) === '|' ) { return; }
        }
    }
    entry.pat = p + '|' + pattern;
};

/******************************************************************************/

RedirectEngine.prototype.fromCompiledRule = function(line) {
    const fields = line.split('\t');
    if ( fields.length !== 5 ) { return; }
    this.addRule(fields[0], fields[1], fields[2], fields[3], fields[4]);
};

/******************************************************************************/

RedirectEngine.prototype.compileRuleFromStaticFilter = function(line) {
    const matches = this.reFilterParser.exec(line);
    if ( matches === null || matches.length !== 4 ) { return; }

    const des = matches[1] || '';

    // https://github.com/uBlockOrigin/uBlock-issues/issues/572
    //   Extract best possible hostname.
    let deshn = des;
    let pos = deshn.lastIndexOf('*');
    if ( pos !== -1 ) {
        deshn = deshn.slice(pos + 1);
        pos = deshn.indexOf('.');
        if ( pos !== -1 ) {
            deshn = deshn.slice(pos + 1);
        } else {
            deshn = '';
        }
    }

    const path = matches[2] || '';
    let pattern =
            des
                .replace(/\*/g, '[\\w.%-]*')
                .replace(/\./g, '\\.') +
            path
                .replace(/\|$/, '$')
                .replace(/[.+?{}()|[\]\/\\]/g, '\\$&')
                .replace(/\^/g, '[^\\w.%-]')
                .replace(/\*/g, '.*?');
    if ( pattern === '' ) {
        pattern = '^';
    }

    let type,
        redirect = '',
        srchns = [];
    for ( const option of matches[3].split(',') ) {
        if ( option.startsWith('redirect=') ) {
            redirect = option.slice(9);
            continue;
        }
        if ( option.startsWith('redirect-rule=') ) {
            redirect = option.slice(14);
            continue;
        }
        if ( option === 'empty' ) {
            redirect = 'empty';
            continue;
        }
        if ( option === 'mp4' ) {
            redirect = 'noopmp4-1s';
            continue;
        }
        if ( option.startsWith('domain=') ) {
            srchns = option.slice(7).split('|');
            continue;
        }
        if ( (option === 'first-party' || option === '1p') && deshn !== '' ) {
            srchns.push(µBlock.URI.domainFromHostname(deshn) || deshn);
            continue;
        }
        // One and only one type must be specified.
        if ( this.supportedTypes.has(option) ) {
            if ( type !== undefined ) { return; }
            type = this.supportedTypes.get(option);
            continue;
        }
    }

    // Need a resource token.
    if ( redirect === '' ) { return; }

    // Need one single type -- not negated.
    if ( type === undefined ) {
        if ( redirect === 'empty' ) {
            type = '*';
        } else if ( redirect === 'noopmp4-1s' ) {
            type = 'media';
        } else {
            return;
        }
    }

    if ( deshn === '' ) {
        deshn = '*';
    }

    if ( srchns.length === 0 ) {
        srchns.push('*');
    }

    const out = [];
    for ( const srchn of srchns ) {
        if ( srchn === '' ) { continue; }
        if ( srchn.startsWith('~') ) { continue; }
        out.push(`${srchn}\t${deshn}\t${type}\t${pattern}\t${redirect}`);
    }

    if ( out.length === 0 ) { return; }

    return out;
};

/******************************************************************************/

RedirectEngine.prototype.reFilterParser = /^(?:\|\|([^\/:?#^]+)|\*)([^$]+)?\$([^$]+)$/;

RedirectEngine.prototype.supportedTypes = new Map([
    [ 'css', 'stylesheet' ],
    [ 'font', 'font' ],
    [ 'image', 'image' ],
    [ 'media', 'media' ],
    [ 'object', 'object' ],
    [ 'script', 'script' ],
    [ 'stylesheet', 'stylesheet' ],
    [ 'frame', 'sub_frame' ],
    [ 'subdocument', 'sub_frame' ],
    [ 'xhr', 'xmlhttprequest' ],
    [ 'xmlhttprequest', 'xmlhttprequest' ],
]);

/******************************************************************************/

RedirectEngine.prototype.toSelfie = function(path) {
    // Because rules may contains RegExp instances, we need to manually
    // convert it to a serializable format. The serialized format must be
    // suitable to be used as an argument to the Map() constructor.
    const rules = [];
    for ( const item of this.rules ) {
        const rule = [ item[0], [] ];
        const entries = item[1];
        let i = entries.length;
        while ( i-- ) {
            const entry = entries[i];
            rule[1].push({
                tok: entry.tok,
                pat: entry.pat instanceof RegExp ? entry.pat.source : entry.pat
            });
        }
        rules.push(rule);
    }
    return µBlock.assets.put(
        `${path}/main`,
        JSON.stringify({
            rules: rules,
            ruleSources: Array.from(this.ruleSources),
            ruleDestinations: Array.from(this.ruleDestinations)
        })
    );
};

/******************************************************************************/

RedirectEngine.prototype.fromSelfie = async function(path) {
    const result = await µBlock.assets.get(`${path}/main`);
    let selfie;
    try {
        selfie = JSON.parse(result.content);
    } catch (ex) {
    }
    if ( selfie instanceof Object === false ) { return false; }
    this.rules = new Map(selfie.rules);
    this.ruleSources = new Set(selfie.ruleSources);
    this.ruleDestinations = new Set(selfie.ruleDestinations);
    this.resetCache();
    this.modifyTime = Date.now();
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

// TODO: combine same key-redirect pairs into a single regex.

// https://github.com/uBlockOrigin/uAssets/commit/deefe875551197d655f79cb540e62dfc17c95f42
//   Consider 'none' a reserved keyword, to be used to disable redirection.

RedirectEngine.prototype.resourcesFromString = function(text) {
    const lineIter = new µBlock.LineIterator(removeTopCommentBlock(text));
    const reNonEmptyLine = /\S/;
    let fields, encoded, details;

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
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
                details = {};
            }
            const [ prop, value ] = line.slice(4).trim().split(/\s+/);
            if ( value !== undefined ) {
                details[prop] = value;
            }
            continue;
        }

        if ( reNonEmptyLine.test(line) ) {
            fields.push(encoded ? line.trim() : line);
            continue;
        }

        const name = this.aliases.get(fields[0]) || fields[0];
        const mime = fields[1];
        const content = µBlock.orphanizeString(
            fields.slice(2).join(encoded ? '' : '\n')
        );

        // No more data, add the resource.
        this.resources.set(
            name,
            RedirectEntry.fromContent(mime, content)
        );

        if ( details instanceof Object && details.alias ) {
            this.aliases.set(details.alias, name);
        }

        fields = undefined;
        details = undefined;
    }

    // Process pending resource data.
    if ( fields !== undefined ) {
        const name = fields[0];
        const mime = fields[1];
        const content = µBlock.orphanizeString(
            fields.slice(2).join(encoded ? '' : '\n')
        );
        this.resources.set(
            name,
            RedirectEntry.fromContent(mime, content)
        );
        if ( details instanceof Object && details.alias ) {
            this.aliases.set(details.alias, name);
        }
    }

    this.modifyTime = Date.now();
};

const removeTopCommentBlock = function(text) {
    return text.replace(/^\/\*[\S\s]+?\n\*\/\s*/, '');
};

/******************************************************************************/

RedirectEngine.prototype.loadBuiltinResources = function() {
    // TODO: remove once usage of uBO 1.20.4 is widespread.
    µBlock.assets.remove('ublock-resources');

    this.resources = new Map();
    this.aliases = new Map();

    const fetches = [
        µBlock.assets.fetchText(
            '/assets/resources/scriptlets.js'
        ).then(result => {
            const content = result.content;
            if ( typeof content === 'string' && content.length !== 0 ) {
                this.resourcesFromString(content);
            }
        }),
    ];

    const store = (name, data = undefined) => {
        const details = redirectableResources.get(name);
        const entry = RedirectEntry.fromSelfie({
            mime: mimeFromName(name),
            data,
            warURL: vAPI.getURL(`/web_accessible_resources/${name}`),
        });
        this.resources.set(name, entry);
        if ( details.alias !== undefined ) {
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
            µBlock.assets.fetch(
                `/web_accessible_resources/${name}${vAPI.warSecret()}`,
                { responseType: details.data }
            ).then(
                result => process(result)
            )
        );
    }

    return Promise.all(fetches);
}; 

/******************************************************************************/

const resourcesSelfieVersion = 5;

RedirectEngine.prototype.selfieFromResources = function() {
    µBlock.assets.put(
        'compiled/redirectEngine/resources',
        JSON.stringify({
            version: resourcesSelfieVersion,
            aliases: Array.from(this.aliases),
            resources: Array.from(this.resources),
        })
    );
};

RedirectEngine.prototype.resourcesFromSelfie = async function() {
    const result = await µBlock.assets.get('compiled/redirectEngine/resources');
    let selfie;
    try {
        selfie = JSON.parse(result.content);
    } catch(ex) {
    }
    if (
        selfie instanceof Object === false ||
        selfie.version !== resourcesSelfieVersion ||
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

RedirectEngine.prototype.invalidateResourcesSelfie = function() {
    µBlock.assets.remove('compiled/redirectEngine/resources');

    // TODO: obsolete, remove eventually
    µBlock.cacheStorage.remove('resourcesSelfie');
};

/******************************************************************************/
/******************************************************************************/

return new RedirectEngine();

/******************************************************************************/

})();
