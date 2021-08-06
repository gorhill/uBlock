# uBlock Origin Core

The core filtering engines used in the uBlock Origin ("uBO") extension, and has
no external dependencies.

## Installation

Install: `npm install --save @gorhill/ubo-core`

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
engine, which API must be imported as follow:

```js
import { FilteringContext, pslInit, useRawLists } from '@gorhill/ubo-core';
```

If you must import as a NodeJS module:

```js
const { FilteringContext, pslInit, useRawLists } await import from '@gorhill/ubo-core';
```

uBO's SNFE works best with a properly initialized Public Suffix List database,
since it needs to evaluate whether a network request to match is either 1st-
or 3rd-party to the context in which it is fired:

```js
await pslInit();
```

Now feed the SNFE with filter lists -- `useRawLists()` accepts an array of
objects (or promises to object) which expose the raw text of a list
through the `raw` property, and optionally the name of the list through the
`name` property (how you fetch the lists is up to you):

```js
const snfe = await useRawLists([
    fetch('easylist').then(raw => ({ name: 'easylist', raw })),
    fetch('easyprivacy').then(raw => ({ name: 'easyprivacy', raw })),
]);
```

`useRawLists()` returns a reference to the SNFE, which you can use later to
match network requests. First we need a filtering context instance, which is
required as an argument to match networkrequests:

```js
const fctxt = new FilteringContext();
```

Now we are ready to match network requests:

```js
// Not blocked
fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
fctxt.setURL('https://www.bloomberg.com/tophat/assets/v2.6.1/that.css');
fctxt.setType('stylesheet');
if ( snfe.matchRequest(fctxt) !== 0 ) {
    console.log(snfe.toLogData());
}

// Blocked
fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
fctxt.setURL('https://securepubads.g.doubleclick.net/tag/js/gpt.js');
fctxt.setType('script');
if ( snfe.matchRequest(fctxt) !== 0 ) {
    console.log(snfe.toLogData());
}

// Unblocked
fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
fctxt.setURL('https://sourcepointcmp.bloomberg.com/ccpa.js');
fctxt.setType('script');
if ( snfe.matchRequest(fctxt) !== 0 ) {
    console.log(snfe.toLogData());
}
```
