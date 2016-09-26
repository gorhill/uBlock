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

  if ( typeof vAPI !== 'object' ) {
      throw new Error('Aborting content-scripts for ' + window.location);
  }

  // no ad extraction in incognito windows (see #236), or parse already exists
  if (vAPI.chrome && chrome.extension.inIncognitoContext || vAPI.adParser)
    return;

  vAPI.adParser = (function () {

    // we ignore the tiny ad-choice ads from google, ms, etc.
    var ignoreTargets = [
      'http://www.google.com/settings/ads/anonymous',
      'http://choice.microsoft.com'
    ];

    var findImageAd = function (img) {

      var imgSrc = img.src || img.getAttribute("src");

      if (!imgSrc) {

        vAPI.debugAdParsing && console.log("No ImgSrc(#" + i + ")!", img);
        img.addEventListener('load', processDelayedImage, false);
        return false;
      }

      return processImage(img, imgSrc);
    }

    var findImageAds = function (imgs) {

      var hits = 0;
      for (var i = 0; i < imgs.length; i++) {

        if (findImageAd(imgs[i])) hits++;
      }
      return hits > 0;
    }

    var pageCount = function (ads, pageUrl) {

      var num = 0;
      for (var i = 0; i < ads.length; i++) {
        if (ads[i].pageUrl === pageUrl)
          num++;
      }
      return num;
    }

     var clickableParent = function (node) {

      var checkNode = node;

      while (checkNode && checkNode.nodeType ===1) {

        //checkNode && console.log('CHECKING: '+checkNode.tagName, checkNode);
        if (checkNode.tagName === 'A' || checkNode.hasAttribute('onclick')) {
          return checkNode;
        }

        checkNode = checkNode.parentNode;
      }

      return null;
    }

    var Ad = function (network, targetUrl, data) {

      this.id = null;
      this.attempts = 0;
      this.visitedTs = 0; // 0=unattempted, -timestamp=err, +timestamp=ok
      this.attemptedTs = 0;
      this.contentData = data;
      this.contentType = data.src ? 'img' : 'text';
      this.title = data.title || 'Pending';
      this.resolvedTargetUrl = null;
      this.foundTs = +new Date();
      this.targetUrl = targetUrl;
      this.pageTitle = null;
      this.pageUrl = null;
      this.errors = null;
    };

    var processDelayedImage = function () { // this=img

      //console.log('processDelayedImage Size:', this.naturalWidth, this.naturalHeight, this);
      var src = this.src || this.getAttribute('src');
      if (src) {
        if (processImage(this, src))
          console.log("HIT from processDelayedImage!");
      }
      this.removeEventListener('load', processDelayedImage, false);
    }

    var processImage = function (img, src) {

      var target, targetUrl, ad, hits = 0, loc = window.location,
        dbug = (vAPI.debugAdParsing && !vAPI.prefs.production);

      target = clickableParent(img);
      if (target) {

        if (target.hasAttribute('href')) {

          targetUrl = target.getAttribute("href");
        }
        else if (target.hasAttribute('onclick')) {

          // handle onclick
          var onclickInfo = target.getAttribute("onclick");
          if (onclickInfo && onclickInfo.length) {

            targetUrl = parseOnClick(onclickInfo, loc.hostname, loc.protocol);
          }
        }

        if (targetUrl) {

          ad = createAd(document.domain, targetUrl, {
            src: src,
            width: img.naturalWidth || -1,
            height: img.naturalHeight || -1
          });

          if (ad) {

            if (!vAPI.prefs.production) console.log('IMG-AD', ad);
            notifyAddon(ad);
            return true;

          } else if (dbug)
            console.warn("Bail: Unable to create Ad", document.domain, targetUrl, src);

        } else if (dbug)
          console.warn("Bail: No href for anchor", target, img);

      } else if (dbug)
        console.log("Bail: No ClickableParent", img, img.parentNode,
          img.parentNode.parentNode, img.parentNode.parentNode.parentNode);
    }

    // TODO: replace with core::domainFromURI?
    var parseDomain = function (url, useLast) { // dup. in shared

      var domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
      return domains && domains.length ? new URL(
          useLast ? domains[domains.length - 1] : domains[0])
        .hostname : undefined;
    }

    var injectAutoDiv = function (request) { // not used

      var count = pageCount(request.data, request.pageUrl),
        adndiv = document.getElementById("adnauseam-count");

      if (!adndiv) {

        adndiv = document.createElement('div');
        $attr(adndiv, 'id', 'adnauseam-count');
        var body = document.getElementsByTagName("body");
        body.length && body[0].appendChild(adndiv);
        //console.log("Injected: #adnauseam-count");
      }

      $attr(adndiv, 'count', count);
    }

    /******************************** API *********************************/

    var process = function (elem) {

      vAPI.debugAdParsing && console.log('process('+elem.tagName+')',
        elem.tagName==='IFRAME' ? elem.getAttribute('src') : elem);

      switch (elem.tagName) {

      case 'IFRAME':
        elem.addEventListener('load', handleIFrame, false);
        break;

      case 'IMG':
        findImageAds([elem]);
        break;

      default: // other tag-types

        // check the element for child imgs
        var imgs = elem.querySelectorAll('img');
        if (imgs.length) {
          findImageAds(imgs);
        }

        // and finally check for text ads
        vAPI.textAdParser.process(elem);
      }
    };

    var handleIFrame = function () {

      try {
        var doc = this.contentDocument || this.contentWindow.document;
      }
      catch(e) {
        console.log(e); // ignore cross-domain iframes here
        return;
      }
      var imgs = doc.querySelectorAll('img');
      //console.log('handleIFrame: ', imgs.length);
      imgs.length && findImageAds(imgs);
      //vAPI.textAdParser.process(this); // text-ads?
    };

    var notifyAddon = function (ad) {

      vAPI.messaging.send('adnauseam', {
        what: 'registerAd',
        ad: ad
      });

      return true;
    };

    var normalizeUrl = function (proto, host, url) {
      var dbg = proto==='https:'

      if (url.indexOf('http') === 0) return url;

      if (url.indexOf('//') === 0) return proto + url;
      if (url.indexOf('/') !== 0) url = '/' + url;

      return proto + '//' + host + url;
    };

    var createAd = function (network, target, data) {

      var domain = (parent !== window) ?
        parseDomain(document.referrer) : document.domain,
        proto = window.location.protocol || 'http';

      //console.log('createAd:', domain, target, typeof target);

      target = normalizeUrl(proto, domain, target);

      if (target.indexOf('http') < 0) {

        console.warn("Ignoring Ad with targetUrl=" + target, arguments);
        return;
      }

      if (ignoreTargets.indexOf(target) > -1) {

        if (!vAPI.prefs.production) console.log("Ignoring choices-image: ", arguments);
        return;
      }

      return new Ad(network, target, data);
    }

    var useShadowDOM = function () {

        return false; // for now
    }

    // parse the target link from a js onclick handler
    var parseOnClick = function (str, hostname, proto) {

      var result,
        matches = /(?:javascript)?window.open\(([^,]+)[,)]/gi.exec(str);

      if (!(matches && matches.length)) {

        // if failed try generic regex to extract any URLs
        var re = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/gi
        matches = re.exec(str);
      }

      if (matches && matches.length > 0) {

        result = matches[1].replace(/('|"|&quot;)+/g, '');
        return normalizeUrl(proto, hostname, result);
      }
    }

    /**********************************************************************/

    return {

      process: process,
      createAd: createAd,
      notifyAddon: notifyAddon,
      useShadowDOM: useShadowDOM,
      parseOnClick: parseOnClick
    };

  })();

})();
