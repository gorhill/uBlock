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

At the moment, there can be only one instance of the static network filtering
engine ("SNFE"), which proxy API must be imported as follow:

```js
import { StaticNetFilteringEngine } from '@gorhill/ubo-core';
```

If you must import as a NodeJS module:

```js
const { StaticNetFilteringEngine } await import from '@gorhill/ubo-core';
```


Create an instance of SNFE:

```js
const snfe = StaticNetFilteringEngine.create();
```

Feed the SNFE with filter lists -- `useLists()` accepts an array of
objects (or promises to object) which expose the raw text of a list
through the `raw` property, and optionally the name of the list through the
`name` property (how you fetch the lists is up to you):

```js
await snfe.useLists([
    fetch('easylist').then(raw => ({ name: 'easylist', raw })),
    fetch('easyprivacy').then(raw => ({ name: 'easyprivacy', raw })),
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

It is possible to pre-parse filter lists and save the intermediate results for 
later use -- useful to speed up the loading of filter lists. This will be 
documented eventually, but if you feel adventurous, you can look at the code 
and use this capability now if you figure out the details.
