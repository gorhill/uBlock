/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

// For background page or non-background pages

/******************************************************************************/

(function() {

'use strict';

self.vAPI = self.vAPI || {};

/******************************************************************************/

// http://www.w3.org/International/questions/qa-scripts#directions

var setScriptDirection = function(language) {
    document.body.setAttribute(
        'dir',
        ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(language) !== -1 ? 'rtl' : 'ltr'
    );
};

/******************************************************************************/

vAPI.download = function(details) {
    if ( !details.url ) {
        return;
    }

    var a = document.createElement('a');

    if ( 'download' in a ) {
        a.href = details.url;
        a.setAttribute('download', details.filename || '');
        a.dispatchEvent(new MouseEvent('click'));
        return;
    }
    var messager = vAPI.messaging.channel('_download');
    messager.send({
        what: 'gotoURL',
        details: {
            url: details.url,
            index: -1
        }
    });
    messager.close();
};

/******************************************************************************/

vAPI.getURL = function(path) {
    return safari.extension.baseURI + path;
};

/******************************************************************************/

// supported languages
// first language is the default
vAPI.i18nData = [
    'en', 'ar', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fil', 'fr', 'he',
    'hi', 'hr', 'hu', 'id', 'it', 'ja', 'mr', 'nb', 'nl', 'pl', 'pt-BR',
    'pt-PT', 'ro', 'ru', 'sv', 'tr', 'uk', 'vi', 'zh-CN'
];

vAPI.i18n = navigator.language;

if (vAPI.i18nData.indexOf(vAPI.i18n) === -1) {
    vAPI.i18n = vAPI.i18n.slice(0, 2);

    if (vAPI.i18nData.indexOf(vAPI.i18n) === -1) {
        vAPI.i18n = vAPI.i18nData[0];
    }
}

setScriptDirection(vAPI.i18n);

var xhr = new XMLHttpRequest;
xhr.overrideMimeType('application/json;charset=utf-8');
xhr.open('GET', './_locales/' + vAPI.i18n + '.json', false);
xhr.send();
vAPI.i18nData = JSON.parse(xhr.responseText);

vAPI.i18n = function(s) {
    return this.i18nData[s] || s;
};

/******************************************************************************/

// update popover size to its content
if (safari.self.identifier === 'popover') {
    var whenSizeChanges = function(d,l){(function(a,d){function h(a,b){a.addEventListener("scroll",b)}function e(){k.style.width=b.offsetWidth+10+"px";k.style.height=b.offsetHeight+10+"px";b.scrollLeft=b.scrollWidth;b.scrollTop=b.scrollHeight;c.scrollLeft=c.scrollWidth;c.scrollTop=c.scrollHeight;f=a.offsetWidth;g=a.offsetHeight}a.b=d;a.a=document.createElement("div");a.a.style.cssText="position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden";a.a.innerHTML='<div style="position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden"><div style="position:absolute;left:0;top:0;"></div></div><div style="position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden"><div style="position:absolute;left:0;top:0;width:200%;height:200%"></div></div>';
a.appendChild(a.a);var b=a.a.childNodes[0],k=b.childNodes[0],c=a.a.childNodes[1],f,g;e();h(b,function(){(a.offsetWidth>f||a.offsetHeight>g)&&a.b();e()});h(c,function(){(a.offsetWidth<f||a.offsetHeight<g)&&a.b();e()})})(d,l)};
    var onLoaded = function() {
        var body = document.body, popover = safari.self;
        var updateSize = function() {
                popover.width = body.offsetWidth;
                popover.height = body.offsetHeight;
        };
	body.style.position = "relative"; // Necessary for size change detection
	whenSizeChanges(body, updateSize);
	updateSize();
    };
    window.addEventListener('load', onLoaded);
}

/******************************************************************************/

})();

/******************************************************************************/
