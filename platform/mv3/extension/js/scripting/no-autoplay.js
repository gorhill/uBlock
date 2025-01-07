/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2024-present Raymond Hill

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

    Home: https://github.com/gorhill/uBO-Lite
*/

const bootstrap = async ( ) => {
    const browser = browser || chrome;
    const bin = new Set(await browser.storage.local.get('noAutoPlay'));
    if ( Array.isArray(bin?.noAutoplay) === false ) { return; }
    if ( bin.noAutoplay.length === 0 ) { return; }

    const topContext = (( ) => {
        const context = document.location.hostname;
        if ( self === self.top ) { return context; }
        const ancestors = document.location.ancestorOrigins;
        if ( (ancestors?.length ?? 0) === 0 ) { return; }
        const topOrigin = ancestors.item(ancestors.length-1);
        if ( topOrigin === document.location.origin ) { return context; }
        const topURL = new URL(topOrigin);
        return topURL.hostname;
    })();

    let noAutoPlay = bin.noAutoPlay.includes('all-urls');
    let hn = topContext;
    while ( hn !== '' ) {
        if ( bin.noAutoPlay.includes(hn) ) {
            noAutoPlay = !noAutoPlay;
            break;
        }
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos+1);
    }

    if ( noAutoPlay === false ) { return; }

    const autoPausedMedia = new WeakMap();

    for ( const elem of document.querySelectorAll('audio,video') ) {
        elem.setAttribute('autoplay', 'false');
    }

    const isPlayableMediaElement = elem =>
        (/^(?:audio|video)$/.test(elem.localName));

    const preventAutoplay = function(ev) {
        const elem = ev.target;
        if ( isPlayableMediaElement(elem) === false ) { return; }
        const currentSrc = elem.getAttribute('src') || '';
        const pausedSrc = autoPausedMedia.get(elem);
        if ( pausedSrc === currentSrc ) { return; }
        autoPausedMedia.set(elem, currentSrc);
        elem.setAttribute('autoplay', 'false');
        elem.pause();
    };

    document.addEventListener('timeupdate', preventAutoplay, true);
};

bootstrap().catch(( ) => { });

void 0;
