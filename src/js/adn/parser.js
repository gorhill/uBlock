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

  if ( typeof vAPI !== 'object' ) return; // injection failed

  if (typeof vAPI.adCheck === 'function')
    return;

  vAPI.adCheck = function (elem) {
    if (typeof vAPI.adParser === 'undefined') {
      vAPI.adParser = createParser();
    }
    elem && vAPI.adParser.process(elem);
  }

  const ignorableImages = ['mgid_logo_mini_43x20.png', 'data:image/gif;base64,R0lGODlh7AFIAfAAAAAAAAAAACH5BAEAAAAALAAAAADsAUgBAAL+hI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvmMTqvX7Lb7DY/L5/S6/Y7P6/f8vv8PGCg4SFhoeIiYqLjI2Oj4CBkpOUlZaXmJmam5ydnp+QkaKjpKWmp6ipqqusra6voKGys7S1tre4ubq7vL2+v7CxwsPExcbHyMnKy8zNzs/AwdLT1NXW19jZ2tvc3d7f0NHi4+Tl5ufo6err7O3u7+Dh8vP09fb3+Pn6+/z9/v/w8woMCBBAsaPIgwocKFDBs6fAgxosSJFCtavIgxo8b+jRw7evwIMqTIkSRLmjyJMqXKlSxbunwJM6bMmTRr2ryJM6fOnTx7+vwJNKjQoUSLGj2KNKnSpUybOn0KNarUqVSrWr2KNavWrVy7ev0KNqzYsWTLmj2LNq3atWzbun0LN67cuXTr2r2LN6/evXz7+v0LOLDgwYQLGz6MOLHixYwbO34MObLkyZQrW76MObPmzZw7e/4MOrTo0aRLmz6NOrXq1axbu34NO7bs2bRr276NO7fu3bx7+/4NPLjw4cSLGz+OPLny5cybO38OPbr06dSrW7+OPbv27dy7e/8OPrz48eTLmz+PPr369ezbu38PP778+fTr27+PP7/+/fxR+/v/D2CAAg5IYIEGHohgggouyGCDDj4IYYQSTkhhhRZeiGGGGm7IYYcefghiiCKOSGKJJp6IYooqrshiiy6+CGOMMs5IY4023ohjjjruCFYBADs='];

  const createParser = function () {

    const findImageAds = function (imgs) {

      let hits = 0;
      for (let i = 0; i < imgs.length; i++) {

        if (processImage(imgs[i])) hits++;
      }

      if (hits < 1) {
        logP('No (loaded) image Ads found in', imgs);
      }
    };

    const findBgImage = function (elem) {

      logP("findBgImage", elem)

       const attribute =  elem.style.backgroundImage ? elem.style.backgroundImage : elem.style.background;

       if (attribute !== undefined && clickableParent(elem)) {

         const targetUrl = getTargetUrl(elem);
         if (attribute && targetUrl) {

           const src = attribute.match(/\((.*?)\)/)[1].replace(/('|")/g,'');

           // create Image element for ad size
           const img = document.createElement("img");
           img.src = src;

           return createImageAd(img, src, targetUrl);
         }

       } else {

         // TODO: go though all children
       }
    };

    const pageCount = function (ads, pageUrl) {

      let num = 0;
      for (let i = 0; i < ads.length; i++) {
        if (ads[i].pageUrl === pageUrl)
          num++;
      }
      return num;
    };

    const clickableParent = function (node) {

      let checkNode = node;

      while (checkNode && checkNode.nodeType ===1) {

        //checkNode && console.log('CHECKING: '+checkNode.tagName, checkNode);
        if (checkNode.tagName === 'A' || checkNode.hasAttribute('onclick')) {
          return checkNode;
        }

        checkNode = checkNode.parentNode;
      }

      return null;
    }

    const Ad = function (network, targetUrl, data) {

      this.id = null;
      this.attempts = 0;
      this.visitedTs = 0; // 0=unattempted, -timestamp=err, +timestamp=ok
      this.attemptedTs = 0;
      this.contentData = data;
      this.contentType = data.src ? 'img' : 'text';
      this.title = data.title || 'Pending';
      this.foundTs = +new Date();
      this.targetUrl = targetUrl;
      this.pageTitle = null;
      this.pageUrl = null;
    };

    const processImage = function (img) {
      let targetUrl;
      const src = img.src || img.getAttribute("src");

      if (!src) { // no image src

        logP("Fail: no image src", img);
        return;
      }

      targetUrl = getTargetUrl(img);
      if (!targetUrl) return;

      // we have an image and a click-target now
      if (img.complete) {
        // process the image now
        return createImageAd(img, src, targetUrl);
      } else {

        // wait for loading to finish
        img.onload = function() {

          // can't return true here, so findImageAds() will still report
          // 'No Ads found' for the image, but a hit will be still be logged
          // in createImageAd() below
          createImageAd(img, src, targetUrl);
        }
      }
    }

    const getTargetUrl = function(elem) {
      const target = clickableParent(elem);
      let targetUrl;

      if (!target) { // no clickable parent

        logP("Fail: no ClickableParent", elem, elem.parentNode);
        return;
      }

      if (target.hasAttribute('href')) {

        targetUrl = target.getAttribute("href");

        // do we have a relative url
        if (targetUrl.indexOf("/") === 0) {

          // in case the ad is from an iframe
          if (target.hasAttribute('data-original-click-url')) {
            const targetDomain = parseDomain(target.getAttribute("data-original-click-url"));
            const proto = window.location.protocol || 'http';
            targetUrl = normalizeUrl(proto, targetDomain, targetUrl);
          }

          // TODO: do we want to use the pageDomain here?
        }

      } else if (target.hasAttribute('onclick')) {

        const onclickInfo = target.getAttribute("onclick");
        if (onclickInfo && onclickInfo.length) {

          targetUrl = parseOnClick(onclickInfo, loc.hostname, loc.protocol);
        }
      }

      if (!targetUrl) { // no clickable tag in our target

        return warnP("Fail: no href for anchor", target, elem);
      }

      return targetUrl;
    }


    const createImageAd = function (img, src, targetUrl) {
      let ad;
      const iw = img.naturalWidth || -1;
      const ih = img.naturalHeight || -1;
      const minDim = Math.min(iw, ih);
      const maxDim = Math.max(iw, ih);

      function isIgnorable(imgSrc) {
        for (let i = 0; i < ignorableImages.length; i++) {
          if (imgSrc.includes(ignorableImages[i])) {
            return true;
          }
        }
        return false;
      }

      function isFacebookProfilePic(imgSrc, imgWidth) {
        // hack to avoid facebook profile pics
        return (imgSrc.includes("fbcdn.net") && // will fire if w > 0
          imgSrc.includes("scontent") && imgWidth < 150);
      }

      // Check size: require a min-size of 4x31 (if we found a size)
      if (iw > -1 && ih > -1 && (minDim < 4 || maxDim < 31)) {

        return warnP('Ignoring Ad with size ' + iw + 'x' + ih + ': ', src, targetUrl);
      }

      if (isIgnorable(src)) {

        return warnP('Ignorable image: ' + src);
      }

      if (isFacebookProfilePic(src, iw)) {

        return warnP('Ignore fbProf: ' + src + ', w='+iw);
      }

      ad = createAd(document.domain, targetUrl, { src: src, width: iw, height: ih });

      if (ad) {

        if (vAPI.prefs.logEvents) console.log('[PARSED] IMG-AD', ad);
        notifyAddon(ad);
        return true;

      } else {

        warnP("Fail: Unable to create Ad", document.domain, targetUrl, src);
      }
    }

    const parseDomain = function (url, useLast) { // dup. in shared

      const domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
      return domains && domains.length ? new URL(
          useLast ? domains[domains.length - 1] : domains[0])
        .hostname : undefined;
    }

    const isValidDomain = function(v) { // dup in shared

      // from: https://github.com/miguelmota/is-valid-domain/blob/master/is-valid-domain.js
      const re = /^(?!:\/\/)([a-zA-Z0-9-]+\.){0,5}[a-zA-Z0-9-][a-zA-Z0-9-]+\.[a-zA-Z]{2,64}?$/gi;
      return v ? re.test(v) : false;
    };

    const injectAutoDiv = function (request) {
      // not used

      const count = pageCount(request.data, request.pageUrl);

      let adndiv = document.getElementById("adnauseam-count");

      if (!adndiv) {

        adndiv = document.createElement('div');
        $attr(adndiv, 'id', 'adnauseam-count');
        const body = document.getElementsByTagName("body");
        body.length && body[0].appendChild(adndiv);
        //console.log("Injected: #adnauseam-count");
      }

      $attr(adndiv, 'count', count);
    };

    const normalizeUrl = function (proto, host, url) {

      if (!url || url.indexOf('http') === 0) return url;
      if (url.indexOf('//') === 0) return proto + url;
      if (url.indexOf('/') !== 0) url = '/' + url;

      return proto + '//' + host + url;
    };

    const logP = function () {

      if (vAPI.prefs.logEvents) {
        const args = Array.prototype.slice.call(arguments);
        args.unshift('[PARSER]');
        console.log.apply(console, args);
      }
    }

    const warnP = function () {

      if (vAPI.prefs.logEvents) {
        const args = Array.prototype.slice.call(arguments);
        args.unshift('[PARSER]');
        console.warn.apply(console, args);
      }
      return false;
    }

    /******************************** API *********************************/

    const process = function (elem) {

      logP('Process('+elem.tagName+')',
        elem.tagName === 'IFRAME' && elem.hasAttribute('src')
          ? elem.getAttribute('src') : elem);

      //console.log("PARSER.process", vAPI.prefs.logEvents);

      switch (elem.tagName) {

      case 'IFRAME':
        elem.addEventListener('load', processIFrame, false);
        break;

      case 'IMG':
        findImageAds([elem]);
        break;

      default: // other tag-types
        // If element is body/html don't check children, it doens't make sense to check the whole document
        if (elem.tagName == "BODY" || elem.tagName == "HTML") {
          findBgImage(elem);
          return;
        }

        logP('Checking children of', elem);

        const imgs = elem.querySelectorAll('img');
        if (imgs.length) {
          findImageAds(imgs);
        }
        else {
          logP('No img found, check other cases', elem);

          // if no img found within the element
          findGoogleResponsiveDisplayAd(elem) || findBgImage(elem) || logP('No images in children of', elem);
        }

        // and finally check for text ads
        vAPI.textAdParser.process(elem);
      }
    };



    const findGoogleResponsiveDisplayAd = function(elem) {
      // a#mys-content href
      //   div.GoogleActiveViewElement
      //   -> canvas.image background-Image
      //   -> div.title
      //   -> div.row-container > .body

      const googleDisplayAd = elem.querySelector('.GoogleActiveViewElement');
      if (!googleDisplayAd) return;
      logP("[Parser] Google Responsive Display Ad")

      const img = googleDisplayAd.querySelector('canvas.image');

      if (img) {
        // img case
        let src, link, targetURL;

        if (elem.tagName == "A" && elem.id == "mys-content") {
          link = elem
        } else {
          link = elem.querySelector('a#mys-content');
        }

        if (link && link.hasAttribute("href")) {
          targetURL = link.getAttribute("href");
        } else if(link && !link.hasAttribute("href")){
          const clickableElement = img;
          // clickableElement.addEventListener("mousedown", function(){
          //   console.log("Clicked by adnauseam!")
          // })
          // if no href, fake click event
          if (document.createEvent) {
              const ev = document.createEvent('HTMLEvents');
              ev.initEvent('mousedown', true, false);
              clickableElement.dispatchEvent(ev);
          }
        }

        const attribute = getComputedStyle(img).backgroundImage;
        src = attribute.match(/\((.*?)\)/)[1].replace(/('|")/g,'');
        if(!targetURL) targetURL = getTargetUrl(img);

        if (img && src && targetURL){
          createImageAd(img, src, targetURL);
        } else {
          logP("[Google Responsive Display Ad] Can't find element", img, src, targetURL);
        }
      } else {
        // No img, trying to collect as text ad
        const title = googleDisplayAd.querySelector('.title > span'), text = googleDisplayAd.querySelector('.row-container > .body > span');

        if (title && text && targetURL) {

          const ad = vAPI.adParser.createAd('Ads by google responsive display ad', targetURL, {
            title: title.innerText,
            text: text.innerText
          });

          if (ad) {

            if (vAPI.prefs.logEvents) console.log('[PARSED] Responsive Text Ad', ad);
            notifyAddon(ad);
            return true;

          } else {
            warnP("Fail: Unable to create Ad", document.domain, targetUrl);
          }

          return;
        } else {
          logP("[Text Ad Parser] Google Responsive Display Ad")
          vAPI.textAdParser.findGoogleTextAd(elem)
        }

      }



    }

    const processIFrame = function () {

      try {
        const doc = this.contentDocument || this.contentWindow.document|| this.document;
      }
      catch(e) {
        logP('Ignored cross-domain iFrame', this.getAttribute('src'));
        return;
      }
      const imgs = doc.querySelectorAll('img');
      if (imgs.length) {
        findImageAds(imgs);
      }
      else {
        logP('No images in iFrame');
      }
    };

    const notifyAddon = function (ad) {

      vAPI.messaging.send('adnauseam', {
        what: 'registerAd',
        ad: ad
      });

      return true;
    };

    const createAd = function (network, target, data) {

      const domain = (parent !== window) ?
              parseDomain(document.referrer) : document.domain,
            proto = window.location.protocol || 'http';

      // logP('createAd:', target, isValidDomain(parseDomain(target)));

      if (target.indexOf('http') < 0) {// || !isValidDomain(parseDomain(target)) {

        return warnP("Ignoring Ad with targetUrl=" + target, arguments);
      }

      return new Ad(network, target, data);
    }

    const useShadowDOM = function () {

        return false; // for now
    };

    const ocRegex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/gi;

    // parse the target link from a js onclick handler
    const parseOnClick = function (str, hostname, proto) {

      let result, matches = /(?:javascript)?window.open\(([^,]+)[,)]/gi.exec(str);

      if (!(matches && matches.length)) {

        // if failed try generic regex to extract any URLs
        matches = ocRegex.exec(str);
      }

      if (matches && matches.length > 0) {

        result = matches[1].replace(/('|"|&quot;)+/g, '');
        return normalizeUrl(proto, hostname, result);
      }
    }

    return {

      process: process,
      createAd: createAd,
      notifyAddon: notifyAddon,
      useShadowDOM: useShadowDOM,
      parseOnClick: parseOnClick
    };

  };

})();
