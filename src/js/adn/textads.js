/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2016 Daniel C. Howe

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

    Home: https://github.com/dhowe/AdNauseam
*/

(function () {

  'use strict';

  if (window.location === null || typeof vAPI !== 'object') {
    //console.debug('textads.js > window.location===null || vAPI not found');
    return;
  }

  if ( vAPI.textAdParser ) {
      //console.debug('textads.js > already injected');
      return;
  }

  vAPI.textAdParser = (function () {

    /***************************** Functions ******************************/

    var bingText = function (dom) {

      var ad, title = $find(dom, 'h2 a'),
        text = $find(dom, 'div.b_caption p'),
        site = $find(dom, 'div.b_attribution cite');

      if (text.length && site.length && title.length) {

        ad = vAPI.adParser.createAd('bing', $attr(title, 'href'), {
          title: $text(title),
          text: $text(text),
          site: $text(site)
        });

      } else {

        console.warn('TEXT: bingTextHandler.fail: ',
          text, site, document.URL, document.title);
      }

      return [ad];
    }

    var yahooText = function (e) {

      var ads = [],
        divs = $find(e, 'div.dd');

      for (var i = 0; i < divs.length; i++) {

        var title, site, text,
          idiv = $find(divs[i], 'div.compTitle');

        if (idiv.length) {
          title = $find(idiv[0], 'h3.title a');
          site = $find(idiv[0], 'div > a');
        }

        text = $find(divs[i], 'div.compText a');

        if (text.length && site.length && title.length) {

          var ad = vAPI.adParser.createAd('yahoo', $attr(title, 'href'), {
            title: $text(title),
            text: $text(text),
            site: $text(site)
          });

          ads.push(ad);

        } else {

          console.warn('TEXT: yahooTextHandler.fail: ', divs[i]); //title, site, text);
        }
      }

      return ads;
    }

    var aolText = function (div) {

      var ad, title = $find(div, '.title span'),
        text = $find(div, '.desc span'),
        site = $find(div, '.durl span'),
        target = $find(div, '.title a');

      if (text.length && site.length && title.length && target.length) {

        ad = vAPI.adParser.createAd('aol', $attr(target, 'href'), {
          title: $text(title),
          text: $text(text),
          site: $text(site)
        });

      } else {

        console.warn('TEXT: aolTextHandler.fail: ', text, site, document.title, document.URL);
      }

      return [ad];
    }

    var askText = function (dom) { // TODO: not working

      var title = $find(dom, 'a.test_titleLink.d_'),
        site = $find(dom, 'a.test_domainLink.e_'),
        text1 = $find(dom, 'span.descText'),
        text2 = $find(dom, 'span.v_'),
        text;

      text = $text(text1) + (text2 && text2.length ? $text(text2) : '');

      if (text.length && site.length && title.length) {

        var ad = vAPI.adParser.createAd('ask', $attr(title, 'href'), {
          title: $text(title),
          site: $text(site),
          text: text
        });

      } else {

        console.warn('TEXT: askTextHandler.fail: ', text, site, document.URL, document.title);
      }

      return [ad];
    }

    var googleText = function (li) {

      var ad, title = $find(li, 'h3 a'),
        text = $find(li, '.ads-creative'),
        site = $find(li, '.ads-visurl cite');

      if (text.length && site.length && title.length) {

        ad = vAPI.adParser.createAd('google', $attr(title, 'href'), {
          title: $text(title),
          text: $text(text),
          site: $text(site)
        });

      } else {

        console.warn('TEXT: googleTextHandler.fail: ', text, site, document.URL, document.title);
      }

      return [ad];
    }

    var ddgText = function (div) { // not-working, perhaps due to shadow dom

      var ad, title = $find(div, 'h2.result__title'),
        text = $find(div, 'div.result__snippet > a'),
        site = $find(div, 'a.result__a');

      if (text.length && site.length && title.length) {

        ad = vAPI.adParser.createAd('google', $attr(title, 'href'), {
          title: $text(title),
          text: $text(text),
          site: $attr(site, 'href')
        });

      } else {

        console.warn('TEXT: ddgTextHandler.fail: ', text, site, title, div);
      }

      return [ad];
    }

    // TODO: replace with core::domainFromURI
    var parseDomain = function (url, useLast) { // dup. in shared

      var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
      return domains && domains.length ? new URL(
          useLast ? domains[domains.length - 1] : domains[0])
        .hostname : undefined;
    }

    /*************************** JQUERY-SHIMS ****************************/

    var $is = function (elem, selector) { // jquery shim

      if (selector.nodeType) {
        return elem === selector;
      }

      var qa = (typeof (selector) === 'string' ?
          document.querySelectorAll(selector) : selector),
        length = qa.length,
        returnArr = [];

      while (length--) {
        if (qa[length] === elem) {
          return true;
        }
      }

      return false;
    };

    var $attr = function (ele, attr, val) { // jquery shim

      return val ? (ele.length ? ele[0] : ele).setAttribute(attr, val) :
        (ele.length ? ele[0] : ele).getAttribute(attr);
    };

    var $text = function (ele) { // jquery shim

      if (typeof ele.length === 'undefined')
        return ele.innerText || ele.textContent;

      var text = '';
      for (var i = 0; i < ele.length; i++) {

        text += ele[i].innerText || ele[i].textContent;
      }

      return text;
    };

    var $find = function (ele, selector) { // jquery shim

      return ele && (ele.length ? ele[0] : ele).querySelectorAll(selector);
    };

    /******************************** VARS ********************************/

    var googleRegex = /^(www\.)*google\.((com\.|co\.|it\.)?([a-z]{2})|com)$/i;

    var filters = [{
      selector: 'li.ads-ad',
      handler: googleText,
      name: 'google',
      domain: googleRegex
    }, {
      selector: '.ad.a_',
      handler: askText, // not working
      name: 'ask',
      domain: /^.*\.ask\.com$/i
    }, {
      selector: '.ad',
      handler: aolText,
      name: 'aol',
      domain: /^.*\.aol\.com(\.([a-z]{2}))?$/i
    }, {
      selector: 'div#ads',
      handler: ddgText,
      name: 'ddg',
      domain: /^(.*\.)?duckduckgo\.com/i
    }, {
      selector: 'div',
      handler: yahooText,
      name: 'yahoo',
      domain: /^.*\.yahoo\.com/i
    }, {
      selector: 'li.b_ad',
      handler: bingText,
      name: 'bing',
      domain: /^.*\.bing\.com/i
    }];

    var checkFilters = function (elem) {

      var active = filters.filter(function (f) {
        var domain = (parent !== window) ? parseDomain(document.referrer) : document.domain;
        var matched = f.domain.test(domain);
        //if (!matched) console.warn('Domain mismatch: ' + domain + ' != ' + f.domain);
        return matched;
      });

      for (var i = 0; i < active.length; i++) {

        if ($is(elem, active[i].selector)) {

          return active[i].handler(elem);
        }
      }
    }

    /******************************** API *********************************/

    var process = function (elem) {

        if (vAPI.prefs.textAdsDisabled) {
          console.log("adn: texts-ads disabled");
          return;
        }

        //console.log('TextAds.process()', elem);

        var ads = checkFilters(elem);
        if (ads) {

          for (var i = 0; i < ads.length; i++) {
            if (!vAPI.prefs.production) console.log("TEXT-AD", ads[i]);
            vAPI.adParser.notifyAddon(ads[i]);
          }
        }
      }
      /**********************************************************************/

    return {

      process: process
    };

  })();

})();
