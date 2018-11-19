/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-present Raymond Hill

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

/* globals WebAssembly */
/* exported hnTrieManager */

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

  The resulting read-only tries created as a result of using hnTrieManager are
  simply just typed arrays filled with integers. The matching algorithm is
  just a matter of reading/comparing these integers, and further using them as
  indices in the array as a way to move around in the trie.

  [1] To solve <https://github.com/gorhill/uBlock/issues/3193>

*/

const hnTrieManager = {
    tree: null,
    treesz: 0,
    trie: new Uint8Array(65536),
    trie32: null,
    triesz: 256,    // bytes 0-254: decoded needle, byte 255: needle length
    id: 0,
    needle: '',
    wasmLoading: null,
    wasmMemory: null,
    cleanupToken: 0,
    cleanupTimer: undefined,

    reset: function() {
        if ( this.wasmMemory === null && this.trie.byteLength > 65536 ) {
            this.trie = new Uint8Array(65536);
            this.trie32 = null;
        } else {
            this.trie.fill(0);
        }
        this.triesz = 256;
        this.needle = '';
        this.id += 1;
    },

    readyToUse: function() {
        return this.wasmLoading instanceof Promise
            ? this.wasmLoading
            : Promise.resolve();
    },

    isValidRef: function(ref) {
        return ref !== null && ref.id === this.id;
    },

    setNeedle: function(needle) {
        if ( needle !== this.needle ) {
            const buf = this.trie;
            let i = needle.length;
            if ( i > 254 ) { i = 254; }
            buf[255] = i;
            while ( i-- ) {
                buf[i] = needle.charCodeAt(i);
            }
            this.needle = needle;
        }
        return this;
    },

    matchesJS: function(itrie) {
        const buf = this.trie;
        const buf32 = this.trie32;
        let ineedle = buf[255];
        for (;;) {
            ineedle -= 1;
            const nchar = ineedle === -1 ? 0 : buf[ineedle];
            for (;;) {
                const tchar = buf[itrie+8];         // quick test: first character
                if ( tchar === nchar ) { break; }
                if ( tchar === 0 && nchar === 0x2E ) { return 1; }
                itrie = buf32[itrie >>> 2];
                if ( itrie === 0 ) { return 0; }    // no more descendants
            }
            if ( nchar === 0 ) { return 1; }
            let lxtra = buf[itrie+9];               // length of extra charaters
            if ( lxtra !== 0 ) {                    // cell is only one character
                if ( lxtra > ineedle ) { return 0; }
                let ixtra = itrie + 10;
                lxtra += ixtra;
                do {
                    ineedle -= 1;
                    if ( buf[ineedle] !== buf[ixtra] ) { return 0; }
                    ixtra += 1;
                } while ( ixtra !== lxtra );
            }
            itrie = buf32[itrie + 4 >>> 2];
            if ( itrie === 0 ) {
                return ineedle === 0 || buf[ineedle-1] === 0x2E ? 1 : 0;
            }
        }
    },
    matchesWASM: null,
    matches: null,

    start: function() {
        if ( this.trie32 === null ) {
            this.trie32 = new Uint32Array(this.trie.buffer);
        }
        this.treesz = 0;
        if ( this.tree === null ) {
            this.tree = new Uint32Array(16384);
        }
        this.tree[0] = 0;
        this.tree[1] = 0;
        this.tree[2] = 0;
    },

    /***************************************************************************

      Since this trie is specialized for matching hostnames, the stored
      strings are reversed internally, because of hostname comparison logic:

      Correct matching:
        index      0123456
                   abc.com
                         |
               www.abc.com
        index  01234567890

      Incorrect matching (typically used for plain strings):
        index  0123456
               abc.com
               |
               www.abc.com
        index  01234567890

    */

    add: function(hn) {
        let ichar = hn.length - 1;
        if ( ichar === -1 ) { return; }
        // 256 * 3 + 3 = 771
        if ( this.treesz + 771 >= this.tree.length ) {
            this.growTree();
        }
        if ( ichar > 254 ) { ichar = 254; }
        let c = hn.charCodeAt(ichar),
            i = 0, inext;
        for (;;) {
            if ( this.tree[i+2] !== c ) {       // match not found
                inext = this.tree[i];           // move to descendant
                if ( inext === 0 ) { break; }   // no descendant
            } else {                            // match found
                if ( c === 0 ) { return; }
                inext = this.tree[i+1];         // move to sibling
                ichar -= 1;
                c = ichar === -1 ? 0 : hn.charCodeAt(ichar);
            }
            i = inext;
        }
        // Any new string added will always cause a new descendant to be
        // created. The only time this is not the case is when trying to
        // store a string which is already in the trie.
        inext = this.treesz;            // new descendant cell
        this.tree[i] = inext;
        this.tree[inext+0] = 0;         // jump index to descendant
        this.tree[inext+1] = 0;         // jump index to sibling
        this.tree[inext+2] = c;         // character code
        this.treesz += 3;
        if ( c === 0 ) { return; }      // character zero is always last cell
        do {
            i = inext;                  // new branch sprouting made from
            ichar -= 1;                 // all characters left to store
            c = ichar === -1 ? 0 : hn.charCodeAt(ichar);
            inext = this.treesz;
            this.tree[i+1] = inext;
            this.tree[inext+0] = 0;
            this.tree[inext+1] = 0;
            this.tree[inext+2] = c;
            this.treesz += 3;
        } while ( c!== 0 );
    },

    growTree: function() {
        let tree = new Uint32Array(this.tree.length + 16384);
        tree.set(this.tree);
        this.tree = tree;
    },

    /***************************************************************************

      Before vacuuming, each cell is 3 entry-long:
      - Jump index to descendant (if any)
      - Jump index to sibling (if any)
      - character code

      All strings stored in the un-vacuumed trie are zero-terminated, and the
      character zero does occupy a cell like any other character. Let's
      use _ to represent character zero for sake of comments. The asterisk
      will be used to highlight a node with a descendant.

      Cases, before vacuuming:

        abc.com, abc.org: 16 cells
                                             *
          _ -- a -- b -- c -- . -- c -- o -- m
          _ -- a -- b -- c -- . -- o -- r -- g

        abc.com, xyz.com: 12 cells
                         *
          _ -- a -- b -- c -- . -- c -- o -- m
          _ -- x -- y -- z

        ab.com, b.com: 8 cells
               *
          _ -- a -- b -- . -- c -- o -- m
               _

        b.com, ab.com: 8 cells
               *
               _ -- b -- . -- c -- o -- m
          _ -- a

      Vacuuming is the process of merging sibling cells with no descendants.
      Cells with descendants can't be merged.

      Each time we arrive at the end of a horizontal branch (sibling jump
      index is 0), we walk back to the nearest previous node with descendants,
      and repeat the process. Since there is no index information on where to
      come back, a stack is used to remember cells with descendants (descendant
      jump index is non zero) encountered on the way

      After vacuuming, each cell is 4+n entry-long:
      - Jump index to descendant (if any)
      - Jump index to sibling (if any)
      - character code
      - length of merged character code(s)

      Cases, after vacuuming:

        abc.com, abc.org: 2 cells
                  *
          [abc.co]m
          [abc.or]g

        abc.com, xyz.com: 3 cells
              *
          [ab]c -- [.co]m
          [xy]z

        ab.com, b.com: 3 cells
          *
          a -- [b.co]m
          _

        b.com, ab.com: 3 cells
          *
          _ -- [b.co]m
          a

      It's possible for a character zero cell to have descendants.

      It's not possible for a character zero cell to have next siblings.

      This will have to be taken into account during both vacuuming and
      matching.

      Character zero cells with no descendant are discarded during vacuuming.
      Character zero cells with a descendant, or character zero cells which
      are a decendant are kept into the vacuumed trie.

      A vacuumed trie is very efficient memory- and lookup-wise, but is also
      read-only: no string can be added or removed. The read-only trie is
      really just a self-sufficient array of integers, and can easily be
      exported/imported as a JSON array. It is theoretically possible to
      "decompile" a trie (vacuumed or not) into the set of strings originally
      added to it (in the order they were added with the current
      implementation), but so far I do not need this feature.

      New vacuum output array format:
          byte 0..2: offset to descendant
          byte 3..5: offset to sibling
          byte 6: first character
          byte 7: number of extra characters
          Offset & count values are little-endian.

          4 + 4 + 1 + 1 = 10 bytes for one character, otherwise
          4 + 4 + 1 + 1 + n = 10 + n bytes for one + n character(s)
    */

    finish: function() {
        if ( this.treesz === 0 ) { return null; }
        const input = this.tree,
              iout0 = this.triesz,
              forks = [];
        let output = this.trie,
            output32 = this.trie32,
            iout1 = iout0,
            iout2 = output.byteLength,
            iin = 0;
        for (;;) {
            if ( (iout1 + 266) >= iout2 ) {
                this.growTrie();
                output = this.trie;
                output32 = this.trie32;
                iout2 = output.byteLength;
            }
            let iout = iout1;
            output32[iout >>> 2] = 0;
            output32[iout + 4 >>> 2] = 0;
            output[iout+8] = input[iin+2];              // first character
            output[iout+9] = 0;                         // extra character count
            iout1 += 10;
            if ( input[iin] !== 0 ) {                   // cell with descendant
                forks.push(iout, iin);                  // defer processing
            }
            for (;;) {                                  // merge sibling cell(s)
                iin = input[iin+1];                     // sibling cell
                if ( iin === 0 ) { break; }             // no more sibling cell
                if ( input[iin] !== 0 ) { break; }      // cell with a descendant
                if ( input[iin+2] === 0 ) { break; }    // don't merge \x00
                output[iout1] = input[iin+2];           // add character data
                iout1 += 1;
            }
            if ( iout1 !== iout + 10 ) {                // cells were merged
                output[iout+9] = iout1 - iout - 10;     // so adjust count
            }
            iout1 = (iout1 + 3) & ~3;                   // align to i32
            if ( iin !== 0 && input[iin] !== 0 ) {      // can't merge this cell
                output32[iout + 4 >>> 2] = iout1;
                continue;
            }
            if ( forks.length === 0 ) { break; }        // no more descendants: bye
            iin = forks.pop();                          // process next descendant
            iout = forks.pop();
            iin = input[iin];
            output32[iout >>> 2] = iout1;
        }
        this.triesz = iout1;
        this.cleanupAsync();
        return new HNTrieRef(iout0);
    },

    fromIterable: function(hostnames) {
        this.start();
        const hns = Array.from(hostnames).sort(function(a, b) {
            return a.length - b.length;
        });
        // https://github.com/gorhill/uBlock/issues/3328
        //   Must sort from shortest to longest.
        for ( let hn of hns ) {
            this.add(hn);
        }
        return this.finish();
    },

    fromDomainOpt: function(hostnames) {
        return this.fromIterable(hostnames.split('|'));
    },

    growTrie: function() {
        let trie;
        if ( this.wasmMemory === null ) {
            trie = new Uint8Array(this.trie.byteLength + 65536);
            trie.set(this.trie);
        } else {
            this.wasmMemory.grow(1);
            trie = new Uint8Array(this.wasmMemory.buffer);
        }
        this.trie = trie;
        this.trie32 = new Uint32Array(this.trie.buffer);
    },

    cleanupAsync: function() {
        if ( this.cleanupTimer === undefined ) {
            this.cleanupToken = this.triesz;
            this.cleanupTimer = setTimeout(( ) => {
                this.cleanupTimer = undefined;
                if ( this.cleanupToken !== this.triesz ) {
                    this.cleanupAsync();
                } else {
                    this.tree = null;
                }
            }, 10000);
        }
    },

    // For debugging purpose
    // TODO: currently broken, needs to be fixed as per new buffer format.
    /*
    print: function(offset) {
        let i = offset, cc = [], indent = 0,
            forks = [];
        for (;;) {
            if ( buf[i] !== 0 ) {
                forks.push(i, indent);
            }
            cc.unshift(buf[i+2]);
            for ( let ic = 0; ic < buf[i+3]; ic++ ) {
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
    },
    */
};

/******************************************************************************/

(function() {
    // Default to javascript version.
    hnTrieManager.matches = hnTrieManager.matchesJS;

    if (
        typeof WebAssembly !== 'object' ||
        typeof WebAssembly.instantiateStreaming !== 'function'
    ) {
        return;
    }

    // Soft-dependency on vAPI so that the code here can be used outside of
    // uBO (i.e. tests, benchmarks)
    if (
        typeof vAPI === 'object' &&
        vAPI.webextFlavor.soup.has('firefox') === false
    ) {
        return;
    }

    // Soft-dependency on µBlock's advanced settings so that the code here can
    // be used outside of uBO (i.e. tests, benchmarks)
    if (
        typeof µBlock === 'object' &&
        µBlock.hiddenSettings.disableWebAssembly === true
    ) {
        return;
    }

    // The wasm module will work only if CPU is natively little-endian,
    // as we use native uint32 array in our trie-creation js code.
    const uint32s = new Uint32Array(1);
    const uint8s = new Uint8Array(uint32s.buffer);
    uint32s[0] = 1;
    if ( uint8s[0] !== 1 ) { return; }    

    // The directory from which the current script was fetched should also
    // contain the related WASM file. The script is fetched from a trusted
    // location, and consequently so will be the related WASM file.
    let workingDir;
    {
        const url = new URL(document.currentScript.src);
        const match = /[^\/]+$/.exec(url.pathname);
        if ( match !== null ) {
            url.pathname = url.pathname.slice(0, match.index);
        }
        workingDir = url.href;
    }

    const memory = new WebAssembly.Memory({ initial: 1 });

    hnTrieManager.wasmLoading = WebAssembly.instantiateStreaming(
        fetch(workingDir + 'wasm/hntrie.wasm'),
        { imports: { memory } }
    ).then(result => {
        hnTrieManager.wasmLoading = null;
        if ( !result || !result.instance ) { return; }
        const pageCount = hnTrieManager.trie.byteLength >>> 16;
        if ( pageCount > 1 ) {
            memory.grow(pageCount - 1);
        }
        const trie = new Uint8Array(memory.buffer);
        trie.set(hnTrieManager.trie);
        hnTrieManager.trie = trie;
        if ( hnTrieManager.trie32 !== null ) {
            hnTrieManager.trie32 = new Uint32Array(memory.buffer);
        }
        hnTrieManager.wasmMemory = memory;
        hnTrieManager.matchesWASM = result.instance.exports.matches;
        hnTrieManager.matches = hnTrieManager.matchesWASM;
    }).catch(reason => {
        hnTrieManager.wasmLoading = null;
        console.error(reason);
    });
})();

/******************************************************************************/

const HNTrieRef = function(offset) {
    this.id = hnTrieManager.id;
    this.offset = offset;
};

HNTrieRef.prototype = {
    isValid: function() {
        return this.id === hnTrieManager.id;
    },
    matches: function(needle) {
        return hnTrieManager.setNeedle(needle).matches(this.offset);
    },
    matchesJS: function(needle) {
        return hnTrieManager.setNeedle(needle).matchesJS(this.offset);
    },
    matchesWASM: function(needle) {
        return hnTrieManager.setNeedle(needle).matchesWASM(this.offset);
    },
};
