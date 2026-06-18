/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2024 Daniel C. Howe

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

  if (typeof vAPI !== 'object') return; // injection failed

  if (typeof vAPI.adCheck === 'function') return;

  vAPI.adCheck = function (elem) {
    if (typeof vAPI.adParser === 'undefined') {
      vAPI.adParser = createParser();
    }
    elem && vAPI.adParser.process(elem);
  }

  const ignorableImages = ['mgid_logo_mini_43x20.png', 'data:image/gif;base64,R0lGODlh7AFIAfAAAAAAAAAAACH5BAEAAAAALAAAAADsAUgBAAL+hI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvmMTqvX7Lb7DY/L5/S6/Y7P6/f8vv8PGCg4SFhoeIiYqLjI2Oj4CBkpOUlZaXmJmam5ydnp+QkaKjpKWmp6ipqqusra6voKGys7S1tre4ubq7vL2+v7CxwsPExcbHyMnKy8zNzs/AwdLT1NXW19jZ2tvc3d7f0NHi4+Tl5ufo6err7O3u7+Dh8vP09fb3+Pn6+/z9/v/w8woMCBBAsaPIgwocKFDBs6fAgxosSJFCtavIgxo8b+jRw7evwIMqTIkSRLmjyJMqXKlSxbunwJM6bMmTRr2ryJM6fOnTx7+vwJNKjQoUSLGj2KNKnSpUybOn0KNarUqVSrWr2KNavWrVy7ev0KNqzYsWTLmj2LNq3atWzbun0LN67cuXTr2r2LN6/evXz7+v0LOLDgwYQLGz6MOLHixYwbO34MObLkyZQrW76MObPmzZw7e/4MOrTo0aRLmz6NOrXq1axbu34NO7bs2bRr276NO7fu3bx7+/4NPLjw4cSLGz+OPLny5cybO38OPbr06dSrW7+OPbv27dy7e/8OPrz48eTLmz+PPr369ezbu38PP778+fTr27+PP7/+/fxR+/v/D2CAAg5IYIEGHohgggouyGCDDj4IYYQSTkhhhRZeiGGGGm7IYYcefghiiCKOSGKJJp6IYooqrshiiy6+CGOMMs5IY4023ohjjjruCFYBADs='];
  const ocRegex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/gi;
  const urlRegex = /(?:(?:https?|ftp|file):\/\/|www\.|ftp\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/igm;

  const imgSelectors = [
    'img',
    'amp-img',
    'picture',
    'picture > source[srcset]',
    'img[srcset]',
    '.cropped-image-intermedia-box',
    '.imageholder',
    '[data-imgsrc]',
    '[data-src]',
    '[data-lazy-src]',
    '[data-original]',
    '[data-original-src]',
    '[data-bgset]',
    '[data-background-image]',
    '[data-thumb]',
    '[data-thumbnail]',
    '[data-image-url]',
    '[data-image]',
    '.posterImage-link'
  ];

  function createParser() {

    const findImageAds = function (imgs) {

      let hits = 0;
      for (let i = 0; i < imgs.length; i++) {
        if (processImage(imgs[i])) hits++;
      }

      if (hits < 1) {
        return false
      } else {
        logP('[FIND-IMG] Found ' + hits + ' image ads in ' + imgs.length + ' images');
        return true
      }
    };

    const findVideoAds = function (elements) {
      
      let hits = 0;
      for (let i = 0; i < elements.length; i++) {
        if (processVideo(elements[i])) hits++;
      }

      if (hits < 1) {
        return false
      } else {
        logP('[FIND-VIDEO] Found ' + hits + ' video ads in ' + elements.length + ' videos');
        return true
      }
    };
    

    const getSrcFromAttribute = function (attribute) {
      let src = attribute.match(/\((.*?)\)/);
      if (src && src.length > 1) src = src[1].replace(/('|")/g, '');
      return src
    }

    // Parse srcset attribute and return the best (largest) image URL
    const parseSrcset = function (srcset) {
      if (!srcset) return null;
      // srcset format: "url1 300w, url2 600w" or "url1 1x, url2 2x"
      const candidates = srcset.split(',').map(function(s) { return s.trim(); });
      let bestUrl = null;
      let bestSize = 0;
      for (let i = 0; i < candidates.length; i++) {
        const parts = candidates[i].split(/\s+/);
        if (parts.length >= 1 && parts[0]) {
          const url = parts[0];
          let size = 1;
          if (parts.length > 1) {
            const descriptor = parts[1];
            const num = parseFloat(descriptor);
            if (!isNaN(num)) size = num;
          }
          if (size >= bestSize) {
            bestSize = size;
            bestUrl = url;
          }
        }
      }
      return bestUrl;
    }

    const extractUrlSrc = function (attribute) {
      let src = attribute.match(urlRegex)
      return src && src[0] ;
    } 

    const findBgImage = function (elem) {
      // Try inline style first, then computed style
      var attribute = elem.style.backgroundImage || elem.style.background;
      if (!attribute || attribute === 'none') {
        const computedStyle = getComputedStyle(elem);
        attribute = computedStyle.backgroundImage || computedStyle.background;
      }
      
      if (!attribute || attribute === 'none') {
        return;
      }
      
      
      // Check for clickable parent OR clickable child, then try siblings via parent
      let clickable = clickableParent(elem) || clickableChild(elem);
      if (!clickable && elem.parentNode && elem.parentNode.nodeType === 1) {
        clickable = clickableChild(elem.parentNode);
      }
      if (!clickable) {
        return;
      }
      
      if (attribute && attribute !== 'none' && clickable) {
        const targetUrl = getTargetUrlFromClickable(clickable);
        if (attribute && targetUrl) {
          // create Image element for ad size
          const img = document.createElement("img");
          const src = getSrcFromAttribute(attribute);
          if (!src) {
            logP("Fail: no src found in background attribute", attribute);
            return;
          }
          img.src = src
          
          return createImageAd(img, src, targetUrl);
        } else {
          // No targetUrl from main element, check children with background-image
          var bgElements = elem.querySelector("[style*='background-image'], [style*='background']")
          if (bgElements) {
            // Try inline style first, then computed style for child element
            attribute = bgElements.style.backgroundImage || bgElements.style.background;
            if (!attribute || attribute === 'none') {
              const computedStyle = getComputedStyle(bgElements);
              attribute = computedStyle.backgroundImage || computedStyle.background;
            }
            if (attribute && attribute !== 'none') {
              const childClickable = clickableParent(bgElements) || clickableChild(bgElements);
              const childTargetUrl = childClickable ? getTargetUrlFromClickable(childClickable) : null;
              if (childTargetUrl) {
                const img = document.createElement("img");
                const src = getSrcFromAttribute(attribute);
                if (src) {
                  img.src = src
                  return createImageAd(img, src, childTargetUrl);
                }
              }
            }
          }
        }
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

    // Data attributes commonly used as click targets by ad networks
    const dataClickAttrs = ['data-href', 'data-url', 'data-link', 'data-click-url', 'data-target-url', 'data-beacon'];

    const clickableParent = function (node) {
    let checkNode = node;
    let depth = 0;
    while (checkNode && checkNode.nodeType === 1 && depth < 15) {
      if (checkNode.tagName === 'A' || checkNode.hasAttribute('href')) {
        return checkNode;
      }
      // Only consider onclick if it contains a valid URL
      if (checkNode.hasAttribute('onclick') && onclickHasUrl(checkNode.getAttribute('onclick'))) {
        return checkNode;
      }
      // Check data-href, data-url, data-link, etc.
      for (let i = 0; i < dataClickAttrs.length; i++) {
        if (checkNode.hasAttribute(dataClickAttrs[i])) {
          return checkNode;
        }
      }
      checkNode = checkNode.parentNode;
      depth++;
    }
    return null;
  }

    // Find clickable element within a node (child anchor tags)
    const clickableChild = function (node) {
      if (!node || node.nodeType !== 1) return null;
      // First check if the node itself is clickable
      if (node.tagName === 'A' || node.hasAttribute('href')) {
        return node;
      }
      // Check if the node itself has data click attributes
      for (let i = 0; i < dataClickAttrs.length; i++) {
        if (node.hasAttribute(dataClickAttrs[i])) {
          return node;
        }
      }
      // Look for anchor tags within the element
      const anchors = node.querySelectorAll('a[href]');
      if (anchors.length > 0) {
        return anchors[0]; // Return the first clickable child
      }
      // Check for children with data click attributes
      const dataClickSelector = dataClickAttrs.map(function(a) { return '[' + a + ']'; }).join(', ');
      const dataClickEls = node.querySelectorAll(dataClickSelector);
      if (dataClickEls.length > 0) {
        return dataClickEls[0];
      }
      // Check for elements with onclick handlers containing URLs
      const clickables = node.querySelectorAll('[onclick]');
      for (let i = 0; i < clickables.length; i++) {
        if (onclickHasUrl(clickables[i].getAttribute('onclick'))) {
          return clickables[i];
        }
      }
      return null;
    }

    // Find the closest meaningful text near an element.
    // Walks up the DOM, checking siblings after the element first (below),
    // then siblings before (above), preferring text found lower in the page.
    const closestText = function (el) {
      const MIN_LEN = 3;
      const MAX_LEN = 100;
      const SKIP_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'IFRAME', 'SCRIPT', 'STYLE', 'NOSCRIPT']);

      const extractText = function (node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
        if (SKIP_TAGS.has(node.tagName)) return '';
        const text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length < MIN_LEN) return '';
        // Recurse into children to find the first specific text leaf,
        // avoiding concatenation of unrelated sibling texts (e.g. heading + provider).
        if (node.children.length > 0) {
          for (const child of node.children) {
            const childText = extractText(child);
            if (childText) return childText;
          }
        }
        return text.substring(0, MAX_LEN);
      };

      let current = el;
      for (let level = 0; level < 5; level++) {
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children);
        const idx = siblings.indexOf(current);
        // Prefer siblings after (below the image)
        for (let i = idx + 1; i < siblings.length; i++) {
          const text = extractText(siblings[i]);
          if (text) return text;
        }
        // Fall back to siblings before (above)
        for (let i = idx - 1; i >= 0; i--) {
          const text = extractText(siblings[i]);
          if (text) return text;
        }
        current = parent;
      }
      return '';
    };

    // Helper to check if onclick attribute contains a URL
    const onclickHasUrl = function (onclick) {
      if (!onclick) return false;
      return urlRegex.test(onclick) || ocRegex.test(onclick);
    }

    const Ad = function (network, targetUrl, data) {

      this.id = null;
      this.attempts = 0;
      this.visitedTs = 0; // 0=unattempted, -timestamp=err, +timestamp=ok
      this.attemptedTs = 0;
      this.contentData = data;
      this.contentType = data.src ? 'img' : 'text';
      this.title = data.title || 'No Title';
      this.foundTs = +new Date();
      this.targetUrl = targetUrl;
      this.pageTitle = null;
      this.pageUrl = null;
    };

    const REPROCESS_DELAY = 3000; // 10 seconds in milliseconds

    const canProcess = function (elem) {
      const lastProcessed = elem.getAttribute('process-adn');
      if (!lastProcessed) return true;
      const elapsed = Date.now() - parseInt(lastProcessed, 10);
      return elapsed >= REPROCESS_DELAY;
    }

    const markProcessed = function (elem) {
      elem.setAttribute('process-adn', Date.now().toString());
    }

    const processImage = function (img) {

      if (!canProcess(img)) {
        return false;
      }
      markProcessed(img);

      var src = img.src || img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-bgset") || img.getAttribute("data-imgsrc");

      // Handle <picture> element: get the displayed <img> inside it or first <source srcset>
      if (!src && img.tagName === 'PICTURE') {
        const innerImg = img.querySelector('img');
        if (innerImg) {
          src = innerImg.currentSrc || innerImg.src || innerImg.getAttribute('src');
          // Use the inner img for dimension checking later
          if (src) img = innerImg;
        }
        if (!src) {
          const source = img.querySelector('source[srcset]');
          if (source) {
            src = parseSrcset(source.getAttribute('srcset'));
          }
        }
      }

      // Handle <source> element directly (from querySelectorAll matching 'picture > source[srcset]')
      if (!src && img.tagName === 'SOURCE' && img.hasAttribute('srcset')) {
        src = parseSrcset(img.getAttribute('srcset'));
        // Navigate to parent picture's img for dimensions
        if (img.parentElement && img.parentElement.tagName === 'PICTURE') {
          const innerImg = img.parentElement.querySelector('img');
          if (innerImg) img = innerImg;
        }
      }

      // Fallback: check srcset attribute on <img> itself
      if (!src && img.getAttribute && img.getAttribute('srcset')) {
        src = parseSrcset(img.getAttribute('srcset'));
      }

      // Fallback: check native ad data attributes
      if (!src) {
        src = img.getAttribute('data-thumb') || img.getAttribute('data-thumbnail') 
          || img.getAttribute('data-image-url') || img.getAttribute('data-image')
          || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          || img.getAttribute('data-original-src');
      }

      // ignore this element which only server to generate div size. It is a transparent png image. Fixing https://github.com/dhowe/AdNauseam/issues/1843
      if (img.className === 'i-amphtml-intrinsic-sizer') {
        return;
      }

      if (!src && img.dataset.src) { // try to get data-src which is the case for some images
        let data_src = img.dataset.src
        src = (data_src.indexOf("http://") == 0 || data_src.indexOf("https://") == 0) ? data_src : window.location.host + data_src
      }

      if (!src) { // no image src
        // try to get from background-image style
        let attribute = img.style.backgroundImage || img.style.background;
        if (!attribute || attribute === 'none') {
          const computedStyle = getComputedStyle(img);
          attribute = computedStyle.backgroundImage || computedStyle.background;
          src = extractUrlSrc(attribute);
        }
      }
      
      if (!src) return warnP("[IMG] No image src found", img.tagName, img.id || img.className || '');

      let targetUrl = getTargetUrl(img);

      if (!targetUrl) {
        return;
      }

      // we have an image and a click-target now 
      // OR the image is from type AMP-IMG which doesn't have a "complete parameter", so we let it go through... https://github.com/dhowe/AdNauseam/issues/1843
      if (img.complete || img.tagName === "AMP-IMG" ) {
        // process the image now
        return createImageAd(img, src, targetUrl);

      } else {
        // wait for loading to finish
        img.onload = function () {
          // can't return true here, so findImageAds() will still report
          // 'No Ads found' for the image, but a hit will be still be logged
          // in createImageAd() below
          createImageAd(img, src, targetUrl);
        }
      }
    }

    // Get URL from a known clickable element
    const getTargetUrlFromClickable = function (target) {
      const loc = window.location;
      let targetUrl;

      if (!target) return null;

      if (target.hasAttribute('href')) {
        targetUrl = target.getAttribute("href");

        // do we have a relative url
        if (targetUrl && targetUrl.indexOf("/") === 0) {
          // in case the ad is from an iframe
          if (target.hasAttribute('data-original-click-url')) {
            const targetDomain = parseDomain(target.getAttribute("data-original-click-url"));
            const proto = window.location.protocol || 'http';
            targetUrl = normalizeUrl(proto, targetDomain, targetUrl);
          }
        }
      } else if (target.hasAttribute('onclick')) {
        const onclickInfo = target.getAttribute("onclick");
        if (onclickInfo && onclickInfo.length) {
          targetUrl = parseOnClick(onclickInfo, loc.hostname, loc.protocol);
        }
      }

      // Fallback: check data click attributes (data-href, data-url, data-link, etc.)
      if (!targetUrl) {
        for (let i = 0; i < dataClickAttrs.length; i++) {
          const val = target.getAttribute(dataClickAttrs[i]);
          if (val && val.length > 1) {
            targetUrl = val;
            break;
          }
        }
      }

      return targetUrl;
    }

    const getTargetUrl = function (elem) {

      // Check for clickable parent first, then clickable child
      const target = clickableParent(elem);
      const childTarget = !target ? clickableChild(elem) : null;
      const finalTarget = target || childTarget;
      let targetUrl;

      if (!finalTarget) { // no clickable parent or child
        return;
      }

      targetUrl = getTargetUrlFromClickable(finalTarget);

      if (!targetUrl) { // no clickable tag in our target
        return;
      }

      return targetUrl;
    }

    const createImageAd = function (el, src, targetUrl) {
      let wFallback = parseInt(el.getAttribute("width") || -1)
      let hFallback = parseInt(el.getAttribute("height") || -1)
      
      const iw = el.naturalWidth || wFallback || el.getAttribute("clientWidth");
      const ih = el.naturalHeight || hFallback || el.getAttribute("clientHeight");
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

      // Check size: require a min-size of 30X64 (if we found a size)
      // avoid collecting ad-choice logos
      if (iw > -1 && ih > -1 && (minDim < 31 || maxDim < 65)) {
        return;
      }

      if (isIgnorable(src)) {
        return;
      }

      if (isFacebookProfilePic(src, iw)) {
        return;
      }

      let adTitle = closestText(el);

      // Validate title: reject URLs, JSON, code-like strings
      if (adTitle && (/^https?:\/\//.test(adTitle) || /^{/.test(adTitle) || /^javascript/i.test(adTitle) || /^www\./i.test(adTitle)
          || /^(var|let|const|function)\s/.test(adTitle) || (adTitle.match(/;/g) || []).length >= 2)) {
        adTitle = '';
      }

      // Fallback: try element attributes and parent anchor for a title
      if (!adTitle) {
        const anchor = el.closest('a');
        adTitle = (el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('aria-label')
          || (anchor && (anchor.getAttribute('aria-label') || anchor.getAttribute('title')))
          || '').trim();
      }

      // Last resort: use domain from target URL
      if (!adTitle) {
        adTitle = parseDomain(targetUrl) || '';
      }

      // In iframes, ads often have no nearby text — use 'Pending' so the visit can resolve it
      if (!adTitle) {
        if (window !== window.top) {
          adTitle = 'Pending';
        } else {
          return;
        }
      }
      let ad = createAd(document.domain, targetUrl, { src: src, width: iw, height: ih, title: adTitle });

      if (ad) {
        logP('[PARSED] IMG-AD:', src.substring(0, 60), targetUrl.substring(0, 60));
        notifyAddon(ad);
        return true;
      } else {
        warnP("Fail: Unable to create Ad", document.domain, targetUrl, src);
      }
    }

    const processVideo = function (el) {

      if (!canProcess(el)) {
        return false;
      }
      markProcessed(el);

      if (!el.hasAttribute('poster')) {
        return;
      }

      let src = el.getAttribute('poster');

      if (!src || src.length < 1 ) {
        return;
      }

      if (src.indexOf('http') === 0) {
        return; // do not internal ads for videos 
      }

      // do not collect video ads from same origin 
      var url = new URL(src)
      if (url && url.origin == window.location.origin) {
        return;
      }

      let targetUrl = getTargetUrl(el);

      if (!targetUrl) {
        return;
      }

      return createImageAd(el, src, targetUrl);
    }

    const parseDomain = function (url, useLast) { // dup. in shared

      const domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
      return domains && domains.length ? new URL(
        useLast ? domains[domains.length - 1] : domains[0])
        .hostname : undefined;
    }

    const isValidDomain = function (v) { // dup in shared

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

      if (!canProcess(elem)) {
        return;
      }
      markProcessed(elem);

      var tagName = elem.tagName

      switch (tagName) {
        case 'IFRAME':
          elem.addEventListener('load', processIFrame, false);
        break;
        case 'AMP-IMG':
        case 'IMG':
          findImageAds([elem]);
        break;

        case 'VIDEO':
          findVideoAds([elem]);
        break;
        case 'BODY':
        case 'HTML':
          // If element is body/html don't check children, it doens't make sense to check the whole document
          findBgImage(elem);
        break;
        default:
          var found = false
          const imgs = elem.querySelectorAll(imgSelectors.join(', '));
          if (imgs.length) {
            found = findImageAds(imgs);
            if (found) {
              return;
            }
          }

          const videos = elem.querySelectorAll('video[poster]');
          if (videos.length) {
            found = findVideoAds(videos);
            if (found) {
              return;
            }
          }
        
          
          // Also try findBgImage directly on the element itself
          if (findBgImage(elem)) {
            return;
          }

          // Check children with background-image
          const bgChildren = elem.querySelectorAll('[style*="background"]');
          if (bgChildren.length) {
            for (let i = 0; i < bgChildren.length; i++) {
              if (findBgImage(bgChildren[i])) {
                return;
              }
            }
          }

          // if no img found within the element
          const googleResp = findGoogleResponsiveDisplayAd(elem);
          const googleActive = GoogleActiveViewElement(elem);
          const youtubeAd = findYoutubeTextAd(elem);

          // and finally check for text ads
          vAPI.textAdParser.process(elem);

          // Check for child iframes and process them
          const iframes = elem.querySelectorAll('iframe');
          if (iframes.length) {
            for (let i = 0; i < iframes.length; i++) {
              if (canProcess(iframes[i])) {
                markProcessed(iframes[i]);
                iframes[i].addEventListener('load', processIFrame, false);
                // If iframe is already loaded, process it immediately
                if (iframes[i].contentDocument && iframes[i].contentDocument.readyState === 'complete') {
                  processIFrame.call(iframes[i]);
                }
              }
            }
          }

        break;
      }
      
    };

    const GoogleActiveViewElement = function (elem) {
      // .GoogleActiveViewElement
      // -> .title a
      // -> .body a
      // -> .imageClk .image

      const googleDisplayAd = elem.querySelector('.GoogleActiveViewElement');
      if (!googleDisplayAd) return;

      let url, title, body, image

      title = elem.querySelector(".title a, [class*=title] a")
      body = elem.querySelector(".body a")
      image = elem.querySelector(".imageClk .image")
      
      if (title !== null) {
        url = title.getAttribute("href")
      } else {
        // invalid google ad
        warnP("invalid google ad, no title found.")
        return false
      }

      if ( title !== null && body !== null && url !== null) {
        if (!image) {
          // no image can be found, create text add
          const ad = vAPI.adParser.createAd('GoogleActiveViewElement', url, {
            title: $text(title),
            text: $text(body),
            title: $text(title)
          });
          
          if (ad) {
            logP("[PARSED] TEXT-AD" + ad);
            vAPI.adParser.notifyAddon(ad);
          }
        }
        return true
      } else {
        warnP("invalid google ad, element missing")
        // invalid google ad
        return false
      }
    } 

    const findYoutubeTextAd = function (elem) {
      if (!location.href.includes("youtube.com")){
        return // youtube specific ad banners 
      }
      const youtubeAd = document.querySelector('ytd-promoted-sparkles-web-renderer #sparkles-container');
      if (!youtubeAd) {
        // console.log("[PARSER] no youtubeAd", youtubeAd)
        return;
      }

      logP("[Parser] Youtube Banner Ad Detected")

      const img = youtubeAd.querySelector('yt-img-shadow img');
      const title = youtubeAd.querySelector('#title').innerText;
      const text = youtubeAd.querySelector('#description').innerText;
      const link = youtubeAd.querySelector('#website-text').innerText
      var targetURL = ""
      if (img) {
        var src = img.src
        targetURL = "http://" + link;
        if (img && src && targetURL) {
          createImageAd(img, src, targetURL);
        } else {
          logP("[Google Responsive Display Ad] Can't find element", img, src, targetURL);
        }
      }
      // vAPI.textAdParser.youtubeAds(youtubeAd)
    }

    const findGoogleResponsiveDisplayAd = function (elem) {
      
      // a#mys-content href
      //   div.GoogleActiveViewElement
      //   -> canvas.image background-Image
      //   -> div.title
      //   -> div.row-container > .body

      const googleDisplayAd = elem.querySelector('.GoogleActiveViewElement');
      if (!googleDisplayAd) return false;

      logP("[Parser] Google Responsive Display Ad")

      const img = googleDisplayAd.querySelector('canvas.image');
      const title = googleDisplayAd.querySelector('.title > a');
      const text = googleDisplayAd.querySelector('.body > a');
      
      let targetURL;

      if (img) {

        // img case
        let src, link;

        // check for link element
        if (elem.tagName == "A" && elem.id == "mys-content") {
          link = elem;
        } else {
          link = elem.querySelector('a#mys-content');
        }

        // try to get the targetURL
        if (link && link.hasAttribute("href")) {
          targetURL = link.getAttribute("href");          
        } else if (title && title.hasAttribute("href")) {
          // if cant get link element, try to get it from the title
          targetURL = title.getAttribute("href")
        } else {
          const clickableElement = img;
          // if no href, fake click event
          if (document.createEvent) {
            const ev = document.createEvent('HTMLEvents');
            ev.initEvent('mousedown', true, false);
            clickableElement.dispatchEvent(ev);
          }
        }

        const attribute = getComputedStyle(img).backgroundImage;
        src = extractUrlSrc(attribute);
        if (!targetURL) targetURL = getTargetUrl(img);

        if (img && src && targetURL) {
          createImageAd(img, src, targetURL);
        } else {
          logP("[Google Responsive Display Ad] Can't find element", img, src, targetURL);
        }

      } else {

        // No img, trying to collect as text ad
        if (title) targetURL = title.getAttribute("href")

        if (title && text && targetURL) {

          const ad = vAPI.adParser.createAd('Ads by google responsive display ad', targetURL, {
            title: title.innerText,
            text: text.innerText
          });

          if (ad) {

            if (vAPI.prefs && vAPI.prefs.logEvents) console.log('[PARSED] Responsive Text Ad', ad);
            notifyAddon(ad);
            return true;

          } else {

            warnP("Fail: Unable to create Ad", document.domain, targetUrl);
          }

        } else {

          logP("[Text Ad Parser] Google Responsive Display Ad")
          vAPI.textAdParser.findGoogleTextAd(elem)
        }
      }
    }

    const processIFrame = function () {

      // console.log('[PARSER] processIFrame', this.getAttribute('src'));

      let doc;
      try {
        doc = this.contentDocument || this.contentWindow.document || this.document;
      }
      catch (e) {
        logP('Ignored cross-domain iFrame', this.getAttribute('src'));
        return;
      }

      const imgs = doc.querySelectorAll(imgSelectors.join(', '));
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

      /* const domain = (parent !== window) ?
        parseDomain(document.referrer) : document.domain,
        proto = window.location.protocol || 'http'; */

      // logP('createAd:', target, isValidDomain(parseDomain(target)));

      if (target.indexOf('http') < 0) {// || !isValidDomain(parseDomain(target)) {

        // per https://github.com/dhowe/AdNauseam/issues/1536#issuecomment-835827690
        target = window.location.origin + target;  // changed 5/10/21

        //return warnP("Ignoring Ad with targetUrl=" + target, arguments);
      }

      let newAd = new Ad(network, target, data);
      
      if (newAd && chrome.extension.inIncognitoContext) { // private flag
        newAd.private = true;
      }

      return newAd;
    }

    const useShadowDOM = function () {

      return false; // for now
    };

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

    /*************************** JQUERY-SHIMS ****************************/


    const $attr = function (ele, attr, val) { // jquery shim

      return val ? (ele.length ? ele[0] : ele).setAttribute(attr, val) :
        (ele.length ? ele[0] : ele).getAttribute(attr);
    };

    const $text = function (ele) { // jquery shim

      if (typeof ele.length === 'undefined')
        return ele.innerText || ele.textContent;

      let text = '';
      for (let i = 0; i < ele.length; i++) {

        text += ele[i].innerText || ele[i].textContent;
      }

      return text;
    };
    
    return {
      process: process,
      createAd: createAd,
      notifyAddon: notifyAddon,
      useShadowDOM: useShadowDOM,
      parseOnClick: parseOnClick,
      normalizeUrl: normalizeUrl,
      scanDocument: function () {
        const imgs = document.querySelectorAll(imgSelectors.join(', '));
        if (imgs.length) {
          findImageAds(imgs);
        }
      }
    };

  }

  // When running inside a sub-frame, scan all images on load and watch for dynamic updates.
  // Handles cross-origin iframes where the parent cannot access contentDocument.
  // manifest.json all_frames:true ensures this code runs inside every iframe.
  // Placed at the end of the IIFE so createParser and module-level consts are initialized
  // before the synchronous readyState branch runs (avoids temporal-dead-zone errors).
  if (window !== window.top) {
    let iframeScanDone = false;
    const runIframeScan = function () {
      if (iframeScanDone) return;
      iframeScanDone = true;
      if (typeof vAPI.adParser === 'undefined') {
        vAPI.adParser = createParser();
      }
      vAPI.adParser.scanDocument();
      // Watch for content injected after the initial scan (many ad iframes load creatives dynamically)
      new MutationObserver(function (mutations) {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              vAPI.adCheck(node);
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      runIframeScan();
    } else {
      window.addEventListener('DOMContentLoaded', runIframeScan);
      window.addEventListener('load', runIframeScan);
    }
  }
})();
