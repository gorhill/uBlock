/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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

/*******************************************************************************

  The original prototype was to develop an idea I had about using jump indices
  in a TypedArray for quickly matching hostnames (or more generally strings)[1].
  Once I had a working, un-optimized prototype, I realized I had ended up
  with something formally named a "trie": <https://en.wikipedia.org/wiki/Trie>,
  hence the name. I have no idea whether the implementation here or one
  resembling it has been done elsewhere.

  "HN" in HNTrieBuilder stands for "HostName", because the trie is specialized
  to deal with matching hostnames -- which is a bit more complicated than
  matching plain strings.

  For example, `www.abc.com` is deemed matching `abc.com`, because the former
  is a subdomain of the latter. The opposite is of course not true.

  The resulting read-only trie created as a result of using HNTrieBuilder are
  simply just typed arrays filled with integers. The matching algorithm is
  just a matter of reading/comparing these integers, and further using them as
  indices in the array as a way to move around in the trie.

  There is still place for optimizations. Specifically, I could force the
  strings to be properly sorted so that `HNTrie.matches` could bail earlier
  when trying to find a matching descendant -- but suspect the gain would be
  marginal, if measurable.

  [1] To solve <https://github.com/gorhill/uBlock/issues/3193>

*/

var HNTrieBuilder = function() {
    this.reset();
};

/*******************************************************************************

  A plain javascript array is used to build the trie. It will be casted into
  the appropriate read-only TypedArray[1] at vacuum time.

  [1] Depending on the size: Uint8Array, Uint16Array, or Uint32Array.

*/

HNTrieBuilder.prototype.reset = function() {
    this.buf = [];
    this.bufsz = 0;
    this.buf[0] = 0;
    this.buf[1] = 0;
    this.buf[2] = 0;
    return this;
};

/*******************************************************************************

  Helpers for convenience.

*/

HNTrieBuilder.fromDomainOpt = function(domainOpt) {
    var builder = new HNTrieBuilder();
    builder.fromDomainOpt(domainOpt);
    return builder.vacuum();
};

HNTrieBuilder.fromIterable = function(hostnames) {
    var builder = new HNTrieBuilder();
    builder.fromIterable(hostnames);
    return builder.vacuum();
};

HNTrieBuilder.print = function(trie) {
    var buf = trie.buf,
        i = 0, cc = [], ic, indent = 0,
        forks = [];
    for (;;) {
        if ( buf[i] !== 0 ) {
            forks.push(i, indent);
        }
        if ( buf[i+2] !== 0 ) {
            cc.unshift(buf[i+2]);
        }
        for ( ic = 0; ic < buf[i+3]; ic++ ) {
            cc.unshift(buf[i+4+ic]);
        }
        console.log('\xB7'.repeat(indent) + String.fromCharCode.apply(null, cc));
        indent += cc.length;
        cc = [];
        i = buf[i+1];
        if ( i === 0 ) {
            if ( forks.length === 0 ) { break; }
            indent = forks.pop();
            i = forks.pop();
            i = buf[i];
        }
    }
};

/*******************************************************************************

  Since this trie is specialized for matching hostnames, the stored strings are
  reversed internally, because of hostname comparison logic:

  Correct matching :
    index      0123456
               abc.com
                     |
           www.abc.com
    index  01234567890

  Incorrect matching:
    index  0123456
           abc.com
           |
           www.abc.com
    index  01234567890

*/

HNTrieBuilder.prototype.add = function(hn) {
    var ichar = hn.length - 1;
    if ( ichar === -1 ) { return; }
    var c = hn.charCodeAt(ichar),
        i = 0, inext;
    for (;;) {
        if ( this.buf[i+2] !== c ) {                // match not found
            inext = this.buf[i];                    // move to descendant
            if ( inext === 0 ) { break; }           // no descendant
        } else {                                    // match found
            if ( c === 0 ) { return; }
            inext = this.buf[i+1];                  // move to sibling
            ichar -= 1;
            c = ichar === -1 ? 0 : hn.charCodeAt(ichar);
        }
        i = inext;
    }
    // Any new string added will always cause a new descendant to be created.
    // The only time this is not the case is when trying to store a string
    // which is already in the trie.
    inext = this.bufsz;                 // new descendant cell
    this.buf[i] = inext;
    this.buf[inext+0] = 0;              // jump index to descendant
    this.buf[inext+1] = 0;              // jump index to sibling
    this.buf[inext+2] = c;              // character code
    this.bufsz += 3;
    if ( c === 0 ) { return; }          // character zero is always last cell
    do {                                // new branch sprouting made from
        i = inext;                      // all characters left to store
        ichar -= 1;
        c = ichar === -1 ? 0 : hn.charCodeAt(ichar);
        inext = this.bufsz;
        this.buf[i+1] = inext;
        this.buf[inext+0] = 0;
        this.buf[inext+1] = 0;
        this.buf[inext+2] = c;
        this.bufsz += 3;
    } while ( c!== 0 );
};

/*******************************************************************************

  Not using String.split('|') to avoid memory churning.

*/

HNTrieBuilder.prototype.fromDomainOpt = function(hostnames) {
    var len = hostnames.length,
        beg = 0, end;
    while ( beg < len ) {
        end = hostnames.indexOf('|', beg);
        if ( end === -1 ) { end = len; }
        this.add(hostnames.slice(beg, end));
        beg = end + 1;
    }
    return this;
};

HNTrieBuilder.prototype.fromIterable = function(hostnames) {
    for ( var hn of hostnames ) {
        this.add(hn);
    }
    return this;
};

/******************************************************************************/

HNTrieBuilder.prototype.matches = function(needle) {
    var ichar = needle.length - 1,
        buf = this.buf, i = 0, c;
    for (;;) {
        c = ichar === -1 ? 0 : needle.charCodeAt(ichar);
        while ( buf[i+2] !== c ) {
            i = buf[i];
            if ( i === 0 ) { return false; }
        }
        if ( c === 0 ) { return true; }
        i = buf[i+1];
        if ( i === 0 ) { return c === 0x2E; }
        ichar -= 1;
    }
};

/*******************************************************************************

  Before vacuuming, each cell is 3 entry-long:
  - Jump index to descendant (if any)
  - Jump index to sibling (if any)
  - character code

  All strings stored in the un-vacuumed trie are zero-terminated, and the
  character zero does occupy a cell like any other character. Let's use _ to
  represent character zero for sake of comments. The asterisk will be used to
  highlight a node with a descendant.

  Cases, before vacuuming:

    abc.com, abc.org:
                                         *
      _ -- a -- b -- c -- . -- c -- o -- m
      _ -- a -- b -- c -- . -- o -- r -- g

    abc.com, xyz.com:
                     *
      _ -- a -- b -- c -- . -- c -- o -- m
      _ -- x -- y -- z

    ab.com, b.com:
           *
      _ -- a -- b -- . -- c -- o -- m
           _

    b.com, ab.com:
           *
           _ -- b -- . -- c -- o -- m
      _ -- a

  Vacuuming is the process of merging sibling cells with no descendants. Cells
  with descendants can't be merged.

  Each time we arrive at the end of a horizontal branch (sibling jump index is
  0), we walk back to the nearest previous node with descendants, and repeat
  the process. Since there is no index information on where to come back, a
  stack is used to remember cells with descendants (descendant jump index is
  non zero) encountered on the way

  After vacuuming, each cell is 4+n entry-long:
  - Jump index to descendant (if any)
  - Jump index to sibling (if any)
  - character code
  - length of merged character code(s)

  Cases, after vacuuming:

    abc.com, abc.org:
              *
      [abc.co]m
      [abc.or]g

    abc.com, xyz.com:
          *
      [ab]c -- [.co]m
      [xy]z

    ab.com, b.com:
      *
      a -- [b.co]m
      _

    b.com, ab.com:
      *
      _ -- [b.co]m
      a

  It's possible for a character zero cell to have descendants.

  It's not possible for a character zero cell to have next siblings.

  This will have to be taken into account during both vacuuming and matching.

  Character zero cells with no descendant are discarded during vacuuming.
  Character zero cells with a descendant, or character zero cells which are a
  decendant are kept into the vacuumed trie.

  A vacuumed trie is very efficient memory- and lookup-wise, but is also
  read-only: no string can be added or removed. The read-only trie is really
  just a self-sufficient array of integers, and can easily be exported/imported
  as a JSON array. It is theoretically possible to "decompile" a trie (vacuumed
  or not) into the set of strings originally added to it (in the order they
  were added with the current implementation), but so far I do not need this
  feature.

*/

HNTrieBuilder.prototype.vacuum = function() {
    if ( this.bufsz === 0 ) { return null; }
    var input = this.buf,
        output = [], outsz = 0,
        forks = [],
        iin = 0, iout;
    for (;;) {
        iout = outsz;
        output[iout+0] = 0;
        output[iout+1] = 0;
        output[iout+2] = input[iin+2];              // first character
        output[iout+3] = 0;
        outsz += 4;
        if ( input[iin] !== 0 ) {                   // cell with descendant
            forks.push(iout, iin);                  // defer processing
        }
        for (;;) {                                  // merge sibling cell(s)
            iin = input[iin+1];                     // sibling cell
            if ( iin === 0 ) { break; }             // no more sibling cell
            if ( input[iin] !== 0 ) { break; }      // cell with a descendant
            if ( input[iin+2] === 0 ) { break; }    // don't merge \x00
            output[outsz] = input[iin+2];           // add character data
            outsz += 1;
        }
        if ( outsz !== iout + 4 ) {                 // cells were merged
            output[iout+3] = outsz - iout - 4;      // so adjust count
        }
        if ( iin !== 0 && input[iin] !== 0 ) {      // can't merge this cell
            output[iout+1] = outsz;
            continue;
        }
        if ( forks.length === 0 ) { break; }        // no more descendants: bye
        iin = forks.pop();                          // process next descendant
        iout = forks.pop();
        iin = input[iin];
        output[iout] = outsz;
    }
    var trie;                                       // pick optimal read-only
    if ( outsz < 256 ) {                            // container array.
        trie = new this.HNTrie8(output, outsz);
    } else if ( outsz < 65536 ) {
        trie = new this.HNTrie16(output, outsz);
    } else {
        trie = new this.HNTrie32(output, outsz);
    }
    this.reset();                                   // free working array
    return trie;
};

/*******************************************************************************

  The following internal classes are the actual output of the vacuum() method.

  They use the minimal amount of data to be able to efficiently lookup strings
  in a read-only trie.

  Given that javascript optimizers mind that the type of an argument passed to
  a function always stays the same each time the function is called, there need
  to be three separate implementation of matches() to allow the javascript
  optimizer to do its job.

  The matching code deals only with looking up values in a TypedArray (beside
  calls to String.charCodeAt), so I expect this to be fast and good candidate
  for optimization by javascript engines.

*/

HNTrieBuilder.prototype.HNTrie8 = function(buf, bufsz) {
    this.buf = new Uint8Array(buf.slice(0, bufsz));
};

HNTrieBuilder.prototype.HNTrie8.prototype.matches = function(needle) {
    var ichar = needle.length,
        i = 0, c1, c2, ccnt, ic, i1, i2;
    for (;;) {
        ichar -= 1;
        c1 = ichar === -1 ? 0 : needle.charCodeAt(ichar);
        while ( (c2 = this.buf[i+2]) !== c1 ) {     // quick test: first character
            if ( c2 === 0 && c1 === 0x2E ) { return true; }
            i = this.buf[i];                        // next descendant
            if ( i === 0 ) { return false; }        // no more descendants
        }
        if ( c1 === 0 ) { return true; }
        ccnt = this.buf[i+3];
        if ( ccnt > ichar ) { return false; }
        if ( ccnt !== 0 ) {                         // cell is only one character
            ic = ccnt; i1 = ichar-1; i2 = i+4;
            while ( ic-- && needle.charCodeAt(i1-ic) === this.buf[i2+ic] );
            if ( ic !== -1 ) { return false; }
            ichar -= ccnt;
        }
        i = this.buf[i+1];                          // next sibling
        if ( i === 0 ) {
            return ichar === 0 || needle.charCodeAt(ichar-1) === 0x2E;
        }
    }
};

HNTrieBuilder.prototype.HNTrie16 = function(buf, bufsz) {
    this.buf = new Uint16Array(buf.slice(0, bufsz));
};

HNTrieBuilder.prototype.HNTrie16.prototype.matches = function(needle) {
    var ichar = needle.length,
        i = 0, c1, c2, ccnt, ic, i1, i2;
    for (;;) {
        ichar -= 1;
        c1 = ichar === -1 ? 0 : needle.charCodeAt(ichar);
        while ( (c2 = this.buf[i+2]) !== c1 ) {     // quick test: first character
            if ( c2 === 0 && c1 === 0x2E ) { return true; }
            i = this.buf[i];                        // next descendant
            if ( i === 0 ) { return false; }        // no more descendants
        }
        if ( c1 === 0 ) { return true; }
        ccnt = this.buf[i+3];
        if ( ccnt > ichar ) { return false; }
        if ( ccnt !== 0 ) {                         // cell is only one character
            ic = ccnt; i1 = ichar-1; i2 = i+4;
            while ( ic-- && needle.charCodeAt(i1-ic) === this.buf[i2+ic] );
            if ( ic !== -1 ) { return false; }
            ichar -= ccnt;
        }
        i = this.buf[i+1];                          // next sibling
        if ( i === 0 ) {
            return ichar === 0 || needle.charCodeAt(ichar-1) === 0x2E;
        }
    }
};

HNTrieBuilder.prototype.HNTrie32 = function(buf, bufsz) {
    this.buf = new Uint32Array(buf.slice(0, bufsz));
};

HNTrieBuilder.prototype.HNTrie32.prototype.matches = function(needle) {
    var ichar = needle.length,
        i = 0, c1, c2, ccnt, ic, i1, i2;
    for (;;) {
        ichar -= 1;
        c1 = ichar === -1 ? 0 : needle.charCodeAt(ichar);
        while ( (c2 = this.buf[i+2]) !== c1 ) {     // quick test: first character
            if ( c2 === 0 && c1 === 0x2E ) { return true; }
            i = this.buf[i];                        // next descendant
            if ( i === 0 ) { return false; }        // no more descendants
        }
        if ( c1 === 0 ) { return true; }
        ccnt = this.buf[i+3];
        if ( ccnt > ichar ) { return false; }
        if ( ccnt !== 0 ) {                         // cell is only one character
            ic = ccnt; i1 = ichar-1; i2 = i+4;
            while ( ic-- && needle.charCodeAt(i1-ic) === this.buf[i2+ic] );
            if ( ic !== -1 ) { return false; }
            ichar -= ccnt;
        }
        i = this.buf[i+1];                          // next sibling
        if ( i === 0 ) {
            return ichar === 0 || needle.charCodeAt(ichar-1) === 0x2E;
        }
    }
};
