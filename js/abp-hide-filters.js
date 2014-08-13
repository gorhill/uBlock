/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* jshint bitwise: false */
/* global µBlock */

/******************************************************************************/

µBlock.abpHideFilters = (function(){


/******************************************************************************/

var µb = µBlock;

/******************************************************************************/
/*
var histogram = function(label, buckets) {
    var h = [],
        bucket;
    for ( var k in buckets ) {
        if ( buckets.hasOwnProperty(k) === false ) {
            continue;
        }
        bucket = buckets[k];
        h.push({
            k: k,
            n: bucket instanceof FilterBucket ? bucket.filters.length : 1
        });
    }

    console.log('Histogram %s', label);

    var total = h.length;
    h.sort(function(a, b) { return b.n - a.n; });

    // Find indices of entries of interest
    var target = 3;
    for ( var i = 0; i < total; i++ ) {
        if ( h[i].n === target ) {
            console.log('\tEntries with only %d filter(s) start at index %s (key = "%s")', target, i, h[i].k);
            target -= 1;
        }
    }

    h = h.slice(0, 50);

    h.forEach(function(v) {
        console.log('\tkey="%s" count=%d', v.k, v.n);
    });
    console.log('\tTotal buckets count: %d', total);
};
*/
/******************************************************************************/

// Pure id- and class-based filters
// Examples:
//   #A9AdsMiddleBoxTop
//   .AD-POST

var FilterPlain = function(s) {
    this.s = s;
};

FilterPlain.prototype.retrieve = function(s, out) {
    if ( s === this.s ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Id- and class-based filters with extra selector stuff following.
// Examples:
//   #center_col > div[style="font-size:14px;margin-right:0;min-height:5px"] ...
//   #adframe:not(frameset)
//   .l-container > #fishtank

var FilterPlainMore = function(s) {
    this.s = s;
};

FilterPlainMore.prototype.retrieve = function(s, out) {
    if ( s === this.s.slice(0, s.length) ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Any selector specific to a hostname
// Examples:
//   search.snapdo.com###ABottomD
//   facebook.com##.-cx-PRIVATE-fbAdUnit__root
//   sltrib.com###BLContainer + div[style="height:90px;"]
//   myps3.com.au##.Boxer[style="height: 250px;"]
//   lindaikeji.blogspot.com##a > img[height="600"]
//   japantimes.co.jp##table[align="right"][width="250"]
//   mobilephonetalk.com##[align="center"] > b > a[href^="http://tinyurl.com/"]

var FilterHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterHostname.prototype.retrieve = function(hostname, out) {
    if ( hostname.slice(-this.hostname.length) === this.hostname ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Any selector specific to an entity
// Examples:
//   google.*###cnt #center_col > #res > #topstuff > .ts

var FilterEntity = function(s, entity) {
    this.s = s;
    this.entity = entity;
};

FilterEntity.prototype.retrieve = function(entity, out) {
    if ( entity.slice(-this.entity.length) === this.entity ) {
        out.push(this.s);
    }
};

/******************************************************************************/
/******************************************************************************/

// TODO: evaluate the gain (if any) from avoiding the use of an array for when
// there are only two filters (or three, etc.). I suppose there is a specific
// number of filters below which using an array is more of an overhead than
// using a couple of property members.
// i.e. FilterBucket2, FilterBucket3, FilterBucketN.

var FilterBucket = function(a, b) {
    this.filters = [a, b];
};

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

FilterBucket.prototype.retrieve = function(s, out) {
    var i = this.filters.length;
    while ( i-- ) {
        this.filters[i].retrieve(s, out);
    }
};

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.s = '';
    this.prefix = '';
    this.suffix = '';
    this.anchor = 0;
    this.unhide = 0;
    this.hostnames = [];
    this.invalid = false;
    this.unsupported = false;
    this.reParser = /^\s*([^#]*)(##|#@#)(.+)\s*$/;
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.s = '';
    this.prefix = '';
    this.suffix = '';
    this.anchor = '';
    this.unhide = 0;
    this.hostnames.length = 0;
    this.invalid = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parse = function(s) {
    // important!
    this.reset();

    var matches = this.reParser.exec(s);
    if ( matches === null || matches.length !== 4 ) {
        this.invalid = true;
        return this;
    }

    // Remember original string
    this.s = s;
    this.prefix = matches[1];
    this.anchor = matches[2];
    this.suffix = matches[3];

    // 2014-05-23:
    // https://github.com/gorhill/httpswitchboard/issues/260
    // Any sequence of `#` longer than one means the line is not a valid
    // cosmetic filter.
    if ( this.suffix.indexOf('##') !== -1 ) {
        this.invalid = true;
        return this;
    }

    // Normalize high-medium selectors: `href` is assumed to imply `a` tag. We
    // need to do this here in order to correctly avoid duplicates. The test
    // is designed to minimize overhead -- this is a low occurrence filter.
    if ( this.suffix.charAt(1) === '[' && this.suffix.slice(2, 9) === 'href^="' ) {
        this.suffix = this.suffix.slice(1);
    }

    this.unhide = this.anchor.charAt(1) === '@' ? 1 : 0;
    if ( this.prefix !== '' ) {
        this.hostnames = this.prefix.split(/\s*,\s*/);
    }
    return this;
};

/******************************************************************************/
/******************************************************************************/

// Two Unicode characters:
// T0HHHHHHH HHHHHHHHH
// |       |         | 
// |       |         | 
// |       |         | 
// |       |         +-- bit 8-0 of FNV
// |       |
// |       +-- bit 15-9 of FNV
// |
// +-- filter type (0=hide 1=unhide)
//

var makeHash = function(unhide, token, mask) {
    // Ref: Given a URL, returns a unique 4-character long hash string
    // Based on: FNV32a
    // http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
    // The rest is custom, suited for µBlock.
    var i1 = token.length;
    var i2 = i1 >> 1;
    var i4 = i1 >> 2;
    var i8 = i1 >> 3;
    var hval = (0x811c9dc5 ^ token.charCodeAt(0)) >>> 0;
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i1-1);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval &= mask;
        if ( unhide !== 0 ) {
            hval |= 0x20000;
        }
    return String.fromCharCode(hval >>> 9, hval & 0x1FF);
};

/******************************************************************************/
/******************************************************************************/

// Cosmetic filter family tree:
//
// Generic
//    Low generic simple: class or id only
//    Low generic complex: class or id + extra stuff after
//    High generic:
//       High-low generic: [alt="..."],[title="..."]
//       High-medium generic: [href^="..."]
//       High-high generic: everything else
// Specific
//    Specfic hostname
//    Specific entity
//
// Generic filters can only be enforced once the main document is loaded.
// Specific filers can be enforced before the main document is loaded.

var FilterContainer = function() {
    this.filterParser = new FilterParser();
    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.filterParser.reset();
    this.frozen = false;
    this.acceptedCount = 0;
    this.duplicateCount = 0;
    this.domainHashMask = (1 << 10) - 1;
    this.genericHashMask = (1 << 15) - 1;

    // temporary (at parse time)
    this.lowGenericHide = {};
    this.lowGenericDonthide = {};
    this.highGenericHide = {};
    this.highGenericDonthide = {};
    this.hostnameHide = {};
    this.hostnameDonthide = {};
    this.entityHide = {};
    this.entityDonthide = {};

    // permanent
    // [class], [id]
    this.lowGenericFilters = {};

    // [alt="..."], [title="..."]
    this.highLowGenericHide = {};
    this.highLowGenericDonthide = {};
    this.highLowGenericHideCount = 0;
    this.highLowGenericDonthideCount = 0;
    
    // a[href^="http..."]
    this.highMediumGenericHide = {};
    this.highMediumGenericDonthide = {};
    this.highMediumGenericHideCount = 0;
    this.highMediumGenericDonthideCount = 0;

    // everything else
    this.highHighGenericHide = [];
    this.highHighGenericDonthide = [];
    this.highHighGenericHideCount = 0;
    this.highHighGenericDonthideCount = 0;

    this.hostnameFilters = {};
    this.entityFilters = {};
};

/******************************************************************************/

FilterContainer.prototype.add = function(s) {
    s = s.trim();
    var parsed = this.filterParser.parse(s);
    if ( parsed.invalid ) {
        return false;
    }

    var hostnames = parsed.hostnames;
    var i = hostnames.length;
    if ( i === 0 ) {
        this.addGenericSelector(parsed);
        return true;
    }
    // https://github.com/gorhill/uBlock/issues/151
    // Negated hostname means the filter applies to all non-negated hostnames
    // of same filter OR globally if there is no non-negated hostnames.
    var applyGlobally = true;
    var hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        if ( hostname.charAt(0) !== '~' ) {
            applyGlobally = false;
        }
        this.addSpecificSelector(hostname, parsed);
    }
    if ( applyGlobally ) {
        this.addGenericSelector(parsed);
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addGenericSelector = function(parsed) {
    var entries;
    var selectorType = parsed.suffix.charAt(0);
    if ( selectorType === '#' || selectorType === '.' ) {
        entries = parsed.unhide === 0 ?
            this.lowGenericHide :
            this.lowGenericDonthide;
    } else {
        entries = parsed.unhide === 0 ?
            this.highGenericHide :
            this.highGenericDonthide;
    }
    if ( entries[parsed.suffix] === undefined ) {
        entries[parsed.suffix] = true;
        this.acceptedCount += 1;
    } else {
        this.duplicateCount += 1;
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addSpecificSelector = function(hostname, parsed) {
    // rhill 2014-07-13: new filter class: entity.
    if ( hostname.slice(-2) === '.*' ) {
        this.addEntitySelector(hostname, parsed);
    } else {
        this.addHostnameSelector(hostname, parsed);
    }
};

/******************************************************************************/

FilterContainer.prototype.addHostnameSelector = function(hostname, parsed) {
    // https://github.com/gorhill/uBlock/issues/145
    var unhide = parsed.unhide;
    if ( hostname.charAt(0) === '~' ) {
        hostname = hostname.slice(1);
        unhide ^= 1;
    }
    var entries = unhide === 0 ?
        this.hostnameHide :
        this.hostnameDonthide;
    var entry = entries[hostname];
    if ( entry === undefined ) {
        entry = entries[hostname] = {};
        entry[parsed.suffix] = true;
        this.acceptedCount += 1;
    } else if ( entry[parsed.suffix] === undefined ) {
        entry[parsed.suffix] = true;
        this.acceptedCount += 1;
    } else {
        this.duplicateCount += 1;
    }
};

/******************************************************************************/

FilterContainer.prototype.addEntitySelector = function(hostname, parsed) {
    var entries = parsed.unhide === 0 ?
        this.entityHide :
        this.entityDonthide;
    var entity = hostname.slice(0, -2);
    var entry = entries[entity];
    if ( entry === undefined ) {
        entry = entries[entity] = {};
        entry[parsed.suffix] = true;
        this.acceptedCount += 1;
    } else if ( entry[parsed.suffix] === undefined ) {
        entry[parsed.suffix] = true;
        this.acceptedCount += 1;
    } else {
        this.duplicateCount += 1;
    }
};

/******************************************************************************/

FilterContainer.prototype.freezeLowGenerics = function(what, type) {
    var selectors = this[what];
    var matches, selectorPrefix, f, hash, bucket;
    for ( var selector in selectors ) {
        if ( selectors.hasOwnProperty(selector) === false ) {
            continue;
        }
        matches = this.rePlainSelector.exec(selector);
        if ( !matches ) {
            continue;
        }
        selectorPrefix = matches[1];
        f = selectorPrefix === selector ?
            new FilterPlain(selector) :
            new FilterPlainMore(selector);
        hash = makeHash(type, selectorPrefix, this.genericHashMask);
        bucket = this.lowGenericFilters[hash];
        if ( bucket === undefined ) {
            this.lowGenericFilters[hash] = f;
        } else if ( bucket instanceof FilterBucket ) {
            bucket.add(f);
        } else {
            this.lowGenericFilters[hash] = new FilterBucket(bucket, f);
        }
    }
    this[what] = {};
};

FilterContainer.prototype.rePlainSelector = /^([#.][\w-]+)/;

/******************************************************************************/

FilterContainer.prototype.freezeHostnameSpecifics = function(what, type) {
    var µburi = µb.URI;
    var entries = this[what];
    var filters = this.hostnameFilters;
    var f, hash, bucket;
    for ( var hostname in entries ) {
        if ( entries.hasOwnProperty(hostname) === false ) {
            continue;
        }
        f = new FilterHostname(Object.keys(entries[hostname]).join(','), hostname);
        hash = makeHash(type, µburi.domainFromHostname(hostname), this.domainHashMask);
        bucket = filters[hash];
        if ( bucket === undefined ) {
            filters[hash] = f;
        } else if ( bucket instanceof FilterBucket ) {
            bucket.add(f);
        } else {
            filters[hash] = new FilterBucket(bucket, f);
        }
    }
    this[what] = {};
};

/******************************************************************************/

FilterContainer.prototype.freezeEntitySpecifics = function(what, type) {
    var entries = this[what];
    var filters = this.entityFilters;
    var f, hash, bucket;
    for ( var entity in entries ) {
        if ( entries.hasOwnProperty(entity) === false ) {
            continue;
        }
        f = new FilterEntity(Object.keys(entries[entity]).join(','), entity);
        hash = makeHash(type, entity, this.domainHashMask);
        bucket = filters[hash];
        if ( bucket === undefined ) {
            filters[hash] = f;
        } else if ( bucket instanceof FilterBucket ) {
            bucket.add(f);
        } else {
            filters[hash] = new FilterBucket(bucket, f);
        }
    }
    this[what] = {};
};

/******************************************************************************/

FilterContainer.prototype.freezeHighGenerics = function(what) {
    var selectors = this['highGeneric' + what];

    // ["title"] and ["alt"] will go in high-low generic bin.
    // [href^="..."] wil go in high-mdium generic bin.
    // The rest will be put in the high-high generic bin.
    var highLowGeneric = {};
    var highLowGenericCount = 0;
    var highMediumGeneric = {};
    var highMediumGenericCount = 0;
    var highHighGeneric = [];
    var reHighLow = /^[a-z]*(\[(?:alt|title)="[^"]+"\])$/;
    var reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;
    var matches, hash;
    for ( var selector in selectors ) {
        if ( selectors.hasOwnProperty(selector) === false ) {
            continue;
        }
        matches = reHighLow.exec(selector);
        if ( matches && matches.length === 2 ) {
            highLowGeneric[matches[1]] = true;
            highLowGenericCount += 1;
            continue;
        }
        matches = reHighMedium.exec(selector);
        if ( matches && matches.length === 2 ) {
            hash = matches[1];
            if  ( highMediumGeneric[hash] === undefined ) {
                highMediumGeneric[hash] = matches[0];
            } else {
                highMediumGeneric[hash] += ',\n' + matches[0];
            }
            highMediumGenericCount += 1;
            continue;
        }
        highHighGeneric.push(selector);
    }
    this['highLowGeneric' + what] = highLowGeneric;
    this['highLowGeneric' + what + 'Count'] = highLowGenericCount;
    this['highMediumGeneric' + what] = highMediumGeneric;
    this['highMediumGeneric' + what + 'Count'] = highMediumGenericCount;
    this['highHighGeneric' + what] = highHighGeneric.join(',\n');
    this['highHighGeneric' + what + 'Count'] = highHighGeneric.length;
    this['highGeneric' + what] = {};
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    this.freezeLowGenerics('lowGenericHide', 0);
    this.freezeLowGenerics('lowGenericDonthide', 1);
    this.freezeHighGenerics('Hide');
    this.freezeHighGenerics('Donthide');
    this.freezeHostnameSpecifics('hostnameHide', 0);
    this.freezeHostnameSpecifics('hostnameDonthide', 1);
    this.freezeEntitySpecifics('entityHide', 0);
    this.freezeEntitySpecifics('entityDonthide', 1);
    this.filterParser.reset();
    this.frozen = true;

    //histogram('lowGenericFilters', this.lowGenericFilters);
    //histogram('hostnameFilters', this.hostnameFilters);
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( µb.userSettings.parseAllABPHideFilters !== true ) {
        return;
    }
    if ( !request.selectors ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var r = {
        hide: [],
        donthide: []
    };

    if ( request.highGenerics ) {
        r.highGenerics = {
            hideLow: this.highLowGenericHide,
            hideLowCount: this.highLowGenericHideCount,
            hideMedium: this.highMediumGenericHide,
            hideMediumCount: this.highMediumGenericHideCount,
            hideHigh: this.highHighGenericHide,
            hideHighCount: this.highHighGenericHideCount,
            donthideLow: this.highLowGenericDonthide,
            donthideLowCount: this.highLowGenericDonthideCount,
            donthideMedium: this.highMediumGenericDonthide,
            donthideMediumCount: this.highMediumGenericDonthideCount,
            donthideHigh: this.highHighGenericDonthide,
            donthideHighCount: this.highHighGenericDonthideCount
        };
    }

    var hash, bucket;
    var hashMask = this.genericHashMask;
    var hideSelectors = r.hide;
    var selectors = request.selectors;
    var i = selectors.length;
    var selector;
    while ( i-- ) {
        selector = selectors[i];
        if ( !selector ) {
            continue;
        }
        hash = makeHash(0, selector, hashMask);
        if ( bucket = this.lowGenericFilters[hash] ) {
            bucket.retrieve(selector, hideSelectors);
        }
    }

    //quickProfiler.stop();

    //console.log(
    //    'µBlock> abp-hide-filters.js: %d selectors in => %d selectors out',
    //    request.selectors.length,
    //    r.hide.length + r.donthide.length
    //);

    return r;
};

/******************************************************************************/

FilterContainer.prototype.retrieveDomainSelectors = function(request) {
    if ( µb.userSettings.parseAllABPHideFilters !== true ) {
        return;
    }
    if ( !request.locationURL ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var hostname = µb.URI.hostnameFromURI(request.locationURL);
    var domain = µb.URI.domainFromHostname(hostname);
    var pos = domain.indexOf('.');
    var r = {
        domain: domain,
        entity: pos === -1 ? domain : domain.slice(0, pos - domain.length),
        hide: [],
        donthide: []
    };

    var hash, bucket;
    hash = makeHash(0, r.domain, this.domainHashMask);
    if ( bucket = this.hostnameFilters[hash] ) {
        bucket.retrieve(hostname, r.hide);
    }
    hash = makeHash(0, r.entity, this.domainHashMask);
    if ( bucket = this.entityFilters[hash] ) {
        bucket.retrieve(pos === -1 ? domain : hostname.slice(0, pos - domain.length), r.hide);
    }
    hash = makeHash(1, r.domain, this.domainHashMask);
    if ( bucket = this.hostnameFilters[hash] ) {
        bucket.retrieve(hostname, r.donthide);
    }

    //quickProfiler.stop();

    //console.log(
    //    'µBlock> abp-hide-filters.js: "%s" => %d selectors out',
    //    request.locationURL,
    //    r.hide.length + r.donthide.length
    //);

    return r;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

/******************************************************************************/
