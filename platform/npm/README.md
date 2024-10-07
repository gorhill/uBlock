# uBlock Origin Core

The core filtering engines used in the uBlock Origin ("uBO") extension, and has
no external dependencies.

## Installation

Install: `npm install @gorhill/ubo-core`

This is a very early version and the API is subject to change at any time.

This package uses [native JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules).


## Description

The package contains uBO's static network filtering engine ("SNFE"), which
purpose is to parse and enforce filter lists. The matching algorithm is highly
efficient, and _especially_ optimized to match against large sets of pure
hostnames.

The SNFE can be fed filter lists from a variety of sources, such as [EasyList/EasyPrivacy](https://easylist.to/), 
[uBlock filters](https://github.com/uBlockOrigin/uAssets/tree/master/filters), 
and also lists of domain names or hosts file format (i.e. block lists from [The Block List Project](https://github.com/blocklistproject/Lists#the-block-list-project), 
[Steven Black's HOSTS](https://github.com/StevenBlack/hosts#readme), etc).


## Usage

See `./demo.js` in package for instructions to quickly get started.

At the moment, there can be only one instance of the static network filtering
engine ("SNFE"), which proxy API must be imported as follow:

```js
import { StaticNetFilteringEngine } from '@gorhill/ubo-core';
```

If you must import as a NodeJS module:

```js
const { StaticNetFilteringEngine } = await import('@gorhill/ubo-core');
```


Create an instance of SNFE:

```js
const snfe = await StaticNetFilteringEngine.create();
```

Feed the SNFE with filter lists -- `useLists()` accepts an array of
objects (or promises to object) which expose the raw text of a list
through the `raw` property, and optionally the name of the list through the
`name` property (how you fetch the lists is up to you):

```js
await snfe.useLists([
    fetch('easylist').then(r => r.text()).then(raw => ({ name: 'easylist', raw })),
    fetch('easyprivacy').then(r => r.text()).then(raw => ({ name: 'easyprivacy', raw })),
]);
```

Now we are ready to match network requests:

```js
// Not blocked
if ( snfe.matchRequest({
    originURL: 'https://www.bloomberg.com/',
    url: 'https://www.bloomberg.com/tophat/assets/v2.6.1/that.css',
    type: 'stylesheet'
}) !== 0 ) {
    console.log(snfe.toLogData());
}

// Blocked
if ( snfe.matchRequest({
    originURL: 'https://www.bloomberg.com/',
    url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    type: 'script'
}) !== 0 ) {
    console.log(snfe.toLogData());
}

// Unblocked
if ( snfe.matchRequest({
    originURL: 'https://www.bloomberg.com/',
    url: 'https://sourcepointcmp.bloomberg.com/ccpa.js',
    type: 'script'
}) !== 0 ) {
    console.log(snfe.toLogData());
}
```

Once all the filter lists are loaded into the static network filtering engine,
you can serialize the content of the engine into a JS string:

```js
const serializedData = await snfe.serialize();
```

You can save and later use that JS string to fast-load the content of the
static network filtering engine without having to parse and compile the lists:

```js
const snfe = await StaticNetFilteringEngine.create();
await snfe.deserialize(serializedData);
```

---

## Extras

You can directly use specific APIs exposed by this package, here are some of 
them, which are used internally by uBO's SNFE.

### HNTrieContainer

A well optimised [compressed trie](https://en.wikipedia.org/wiki/Trie#Compressing_tries) 
container specialized to specifically store and lookup hostnames.

The matching algorithm is designed for hostnames, i.e. the hostname labels 
making up a hostname are matched from right to left, such that `www.example.org` 
with be a match if `example.org` is stored into the trie, while 
`anotherexample.org` won't be a match.

`HNTrieContainer` is designed to store a large number of hostnames with CPU and 
memory efficiency as a main concern -- and is a key component of uBO.

To create and use a standalone `HNTrieContainer` object:

```js
import HNTrieContainer from '@gorhill/ubo-core/js/hntrie.js';

const trieContainer = new HNTrieContainer();

const aTrie = trieContainer.createOne();
trieContainer.add(aTrie, 'example.org');
trieContainer.add(aTrie, 'example.com');

const anotherTrie = trieContainer.createOne();
trieContainer.add(anotherTrie, 'foo.invalid');
trieContainer.add(anotherTrie, 'bar.invalid');

// matches() return the position at which the match starts, or -1 when
// there is no match.

// Matches: return 4
console.log("trieContainer.matches(aTrie, 'www.example.org')", trieContainer.matches(aTrie, 'www.example.org'));

// Does not match: return -1
console.log("trieContainer.matches(aTrie, 'www.foo.invalid')", trieContainer.matches(aTrie, 'www.foo.invalid'));

// Does not match: return -1
console.log("trieContainer.matches(anotherTrie, 'www.example.org')", trieContainer.matches(anotherTrie, 'www.example.org'));

// Matches: return 0
console.log("trieContainer.matches(anotherTrie, 'foo.invalid')", trieContainer.matches(anotherTrie, 'foo.invalid'));
```

The `reset()` method must be used to remove all the tries from a trie container, 
you can't remove a single trie from the container.

```js
trieContainer.reset();
```

When you reset a trie container, you can't use the reference to prior instances 
of trie, i.e. `aTrie` and `anotherTrie` are no longer valid and shouldn't be 
used following a reset.
