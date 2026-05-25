/*******************************************************************************
    AdNauseam MV3 - Content script ad parser
    Simplified version of parser.js for MV3
    
    This script gets injected by uBlock Lite's registerInjectables()
    It queries the DOM using cosmetic filter selectors
*******************************************************************************/

(function() {
  'use strict';
  
  // Check if already injected
  if (window.adnParserInjected) return;
  window.adnParserInjected = true;
  
  console.log('[ADN Parser] Loaded on:', window.location.hostname);
  
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

  const titleSelectors = [
    '[data-title-id]',
    '.title',
    '.ad-title',
    '.headline',
    '.ad-headline',
    'h1', 'h2', 'h3', 'h4'
  ];

  const textSelectors = [
    '.ad-description',
    '.ad-text',
    '.description',
    '.ad-body',
    'p',
    'span'
  ];

  function logP(...args) {
    console.log('[ADN Parser]', ...args);
  }

  // Try to extract image src from an element using various data attributes
  function resolveImageSrc(el) {
    if (!el) return null;

    const tag = el.tagName;

    // <source srcset="..."> inside <picture>
    if (tag === 'SOURCE' && el.hasAttribute('srcset')) {
      return parseSrcset(el.getAttribute('srcset'));
    }

    // <img> with srcset
    if (tag === 'IMG') {
      if (el.currentSrc) return el.currentSrc;
      if (el.src) return el.src;
      if (el.hasAttribute('srcset')) return parseSrcset(el.getAttribute('srcset'));
    }

    // <amp-img>
    if (tag === 'AMP-IMG') {
      return el.getAttribute('src') || null;
    }

    // Common lazy-load data attributes
    const attrs = [
      'data-src', 'data-lazy-src', 'data-original', 'data-original-src',
      'data-imgsrc', 'data-bgset', 'data-background-image',
      'data-thumb', 'data-thumbnail', 'data-image-url', 'data-image',
      'src'
    ];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val && val.length > 5) return val;
    }

    return null;
  }

  // Parse first URL from a srcset attribute
  function parseSrcset(srcset) {
    if (!srcset) return null;
    // srcset is "url1 1x, url2 2x, ..." — take the first URL
    const first = srcset.split(',')[0].trim().split(/\s+/)[0];
    return first || null;
  }

  // Get image dimensions from an element
  function getImageDimensions(el) {
    let w = el.naturalWidth || parseInt(el.getAttribute('width')) || el.clientWidth || -1;
    let h = el.naturalHeight || parseInt(el.getAttribute('height')) || el.clientHeight || -1;
    if (isNaN(w)) w = -1;
    if (isNaN(h)) h = -1;
    return { w, h };
  }

  // Extract ad data from element
  function extractAdData(element) {
    const data = {
      targetUrl: null,
      imgSrc: null,
      imgWidth: -1,
      imgHeight: -1,
      text: '',
      title: ''
    };

    // Find target URL — check parents first, then children
    const clickable = findClickableParent(element) || findClickableChild(element);
    if (clickable) {
      if (clickable.hasAttribute('href')) {
        data.targetUrl = clickable.getAttribute('href');
      } else if (clickable.hasAttribute('onclick')) {
        data.targetUrl = parseOnClick(clickable.getAttribute('onclick'));
      }
    }

    if (!data.targetUrl) {
      logP('No targetUrl found for element:', element.className || element.tagName, element);
      return null;
    }

    // Skip internal/relative google tracking links (e.g. /aclk?...)
    if (data.targetUrl.startsWith('/aclk') || data.targetUrl.startsWith('/url?')) {
      logP('  Skipping internal tracking link:', data.targetUrl);
      return null;
    }

    // Make absolute URL
    if (data.targetUrl.indexOf('http') !== 0) {
      if (data.targetUrl.indexOf('//') === 0) {
        data.targetUrl = window.location.protocol + data.targetUrl;
      } else if (data.targetUrl.indexOf('/') === 0) {
        data.targetUrl = window.location.origin + data.targetUrl;
      } else {
        data.targetUrl = window.location.origin + '/' + data.targetUrl;
      }
    }

    logP('Processing element:', element.className || element.tagName, '-> target:', data.targetUrl, element);

    // --- Image search (thorough) ---

    // 1. Check children matching image selectors
    const imgs = element.querySelectorAll(imgSelectors.join(', '));
    logP('  Found', imgs.length, 'image elements matching selectors');

    let chosenImg = null;
    for (const img of imgs) {
      const src = resolveImageSrc(img);
      if (src) {
        const dims = getImageDimensions(img);
        logP('  Image candidate:', src.substring(0, 80), 'dims:', dims.w, 'x', dims.h, img);

        // Prefer real URLs over data URIs (data URIs are often placeholders)
        const isDataUri = src.startsWith('data:');
        const currentIsDataUri = data.imgSrc && data.imgSrc.startsWith('data:');

        if (!data.imgSrc || (currentIsDataUri && !isDataUri) ||
            (!currentIsDataUri && !isDataUri && dims.w > data.imgWidth && dims.h > data.imgHeight)) {
          data.imgSrc = src;
          data.imgWidth = dims.w;
          data.imgHeight = dims.h;
          chosenImg = img;
        }
      }
    }

    // 2. Check the element itself for background-image
    if (!data.imgSrc) {
      logP('  Checking element itself for background-image');
      const bgSrc = getBackgroundImageUrl(element);
      if (bgSrc) {
        data.imgSrc = bgSrc;
        data.imgWidth = element.clientWidth || -1;
        data.imgHeight = element.clientHeight || -1;
        logP('  Found bg image on element:', bgSrc.substring(0, 80));
      }
    }

    // 3. Check children with background-image style
    if (!data.imgSrc) {
      logP('  Checking children for background-image');
      const bgChildren = element.querySelectorAll('[style*="background"]');
      logP('  Found', bgChildren.length, 'children with background style');
      for (const child of bgChildren) {
        const bgSrc = getBackgroundImageUrl(child);
        if (bgSrc) {
          data.imgSrc = bgSrc;
          data.imgWidth = child.clientWidth || -1;
          data.imgHeight = child.clientHeight || -1;
          logP('  Found bg image in child:', bgSrc.substring(0, 80));
          break;
        }
      }
    }

    // Make image URL absolute if needed
    if (data.imgSrc && data.imgSrc.indexOf('http') !== 0 && data.imgSrc.indexOf('data:') !== 0) {
      if (data.imgSrc.indexOf('//') === 0) {
        data.imgSrc = window.location.protocol + data.imgSrc;
      } else if (data.imgSrc.indexOf('/') === 0) {
        data.imgSrc = window.location.origin + data.imgSrc;
      }
    }

    // Validate image dimensions (skip tracking pixels)
    if (data.imgSrc && data.imgWidth > 0 && data.imgHeight > 0) {
      const minDim = Math.min(data.imgWidth, data.imgHeight);
      const maxDim = Math.max(data.imgWidth, data.imgHeight);
      if (minDim < 31 || maxDim < 65) {
        logP('  Image too small (' + data.imgWidth + 'x' + data.imgHeight + '), discarding');
        data.imgSrc = null;
        data.imgWidth = -1;
        data.imgHeight = -1;
      }
    }

    // --- Text extraction (for text ads or as fallback) ---

    // Title — try multiple sources so we have a real title before any visit.
    const titleEl = element.querySelector(titleSelectors.join(', '));
    if (titleEl) {
      data.title = titleEl.textContent.trim();
    }
    if (!data.title && chosenImg) {
      data.title = (chosenImg.getAttribute('alt')
        || chosenImg.getAttribute('title')
        || chosenImg.getAttribute('aria-label')
        || '').trim();
    }
    if (!data.title && clickable) {
      data.title = (clickable.getAttribute('aria-label')
        || clickable.getAttribute('title')
        || '').trim();
      if (!data.title && clickable.tagName === 'A') {
        // Link text, but skip if it's just the image's alt we already tried
        const linkText = clickable.textContent.trim().replace(/\s+/g, ' ');
        if (linkText && linkText.length <= 120) data.title = linkText;
      }
    }
    if (!data.title) {
      data.title = (element.getAttribute('aria-label')
        || element.getAttribute('title')
        || '').trim();
    }
    if (data.title.length > 120) data.title = data.title.substring(0, 120).trim();

    // Reject titles that look like JavaScript/CSS code
    if (data.title && (/^(var|let|const|function)\s/.test(data.title) || (data.title.match(/;/g) || []).length >= 2)) {
      data.title = '';
    }

    // Description text
    if (!data.imgSrc) {
      const textEl = element.querySelector(textSelectors.join(', '));
      if (textEl) {
        data.text = textEl.textContent.trim().substring(0, 200);
      }
      if (!data.text) {
        data.text = element.textContent.trim().substring(0, 200);
      }
    } else {
      data.text = element.textContent.trim().substring(0, 100);
    }

    // Must have either an image or text content
    if (!data.imgSrc && !data.text) {
      logP('  No image and no text found, skipping');
      return null;
    }

    logP('  Result:', data.imgSrc ? 'IMG (' + data.imgWidth + 'x' + data.imgHeight + ')' : 'TEXT',
      data.title ? 'title="' + data.title.substring(0, 40) + '"' : '', element);

    return data;
  }
  
  // Check if onclick attribute contains a valid URL
  function onclickHasUrl(onclickStr) {
    if (!onclickStr) return false;
    // Check for window.open with URL
    if (/window\.open\(['"]https?:\/\//i.test(onclickStr)) return true;
    // Check for location.href assignment
    if (/location\.href\s*=\s*['"]https?:\/\//i.test(onclickStr)) return true;
    // Check for any http(s) URL in the string
    if (/https?:\/\/[^\s'"]+/i.test(onclickStr)) return true;
    return false;
  }

  // Find clickable parent
  function findClickableParent(node) {
    let checkNode = node;
    let depth = 0;
    while (checkNode && checkNode.nodeType === 1 && depth < 10) {
      if (checkNode.tagName === 'A' || checkNode.hasAttribute('href')) {
        return checkNode;
      }
      // Only consider onclick if it contains a valid URL
      if (checkNode.hasAttribute('onclick') && onclickHasUrl(checkNode.getAttribute('onclick'))) {
        return checkNode;
      }
      checkNode = checkNode.parentNode;
      depth++;
    }
    return null;
  }

  // Find clickable child — search inside the element for <a> with external href
  function findClickableChild(node) {
    if (!node) return null;

    // Prefer links with specific ad-link classes (Google PLA, etc.)
    const adLinkSelectors = [
      'a.clickable-card',
      'a.pla-unit-single-clickable-target',
      'a.plantl[href^="http"]',
      'a[data-agdh]',
      'a[href^="http"]'
    ];

    for (const sel of adLinkSelectors) {
      const link = node.querySelector(sel);
      if (link) {
        const href = link.getAttribute('href');
        // Skip internal tracking redirects — we want the actual destination
        if (href && href.startsWith('http')) {
          logP('  Found clickable child via:', sel, link);
          return link;
        }
      }
    }

    // Fallback: any <a> with onclick containing a URL
    const allLinks = node.querySelectorAll('a[onclick]');
    for (const link of allLinks) {
      if (onclickHasUrl(link.getAttribute('onclick'))) {
        logP('  Found clickable child via onclick', link);
        return link;
      }
    }

    return null;
  }
  
  // Extract URL from background-image
  function getBackgroundImageUrl(element) {
    const style = window.getComputedStyle(element);
    const bgImage = style.backgroundImage || style.background;
    
    if (bgImage && bgImage !== 'none') {
      const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }
  
  // Parse onclick handler
  function parseOnClick(onclickStr) {
    if (!onclickStr) return null;
    
    const openMatch = /window\.open\(['"]([^'"]+)['"]/i.exec(onclickStr);
    if (openMatch && openMatch[1]) {
      return openMatch[1];
    }
    
    const urlMatch = /(https?:\/\/[^\s'"]+)/i.exec(onclickStr);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    
    return null;
  }
  
  // Process elements matching cosmetic filters
  // This is called by uBlock's cosmetic filter injection
  function processElements() {
    // Hook into uBlock's cosmetic filter mechanism
    // uBlock hides elements matching these selectors
    // We collect them as ads before they're hidden
    
    // Common ad selectors (fallback if we can't hook into uBlock)
    const defaultSelectors = [
      '.ad',
      '.advertisement', 
      '[data-ad]',
      '.sponsored',
      '.pla-unit',
      '.clickable-card',
      '.GoogleActiveViewElement'
    ];
    
    const selectorStr = defaultSelectors.join(', ');
    
    try {
      const elements = document.querySelectorAll(selectorStr);
      logP('Scanning', elements.length, 'elements on', window.location.hostname);
      
      elements.forEach(element => {
        // Skip if already processed
        // if (element.hasAttribute('data-adn-processed')) return;
        element.setAttribute('data-adn-processed', 'true');
        
        const adData = extractAdData(element);
        if (adData && adData.targetUrl) {
          // Determine type: text ad only if no image AND we have text content
          const isTextAd = !adData.imgSrc;
          const ad = {
            pageUrl: window.location.href,
            pageDomain: window.location.hostname,
            pageTitle: document.title,
            targetUrl: adData.targetUrl,
            foundTs: Date.now(),
            contentType: isTextAd ? 'text' : 'img',
            contentData: isTextAd
              ? { title: adData.title || '', text: adData.text || '', site: window.location.hostname }
              : { src: adData.imgSrc || '', width: adData.imgWidth || -1, height: adData.imgHeight || -1 },
            title: adData.title || (adData.text || '').substring(0, 80) || window.location.hostname,
            attempts: 0,
            visitedTs: 0,
          };

          logP('Found ad:', ad.contentType, ad.contentType === 'img'
            ? '(' + ad.contentData.width + 'x' + ad.contentData.height + ') src=' + (ad.contentData.src || '').substring(0, 60)
            : 'title="' + (ad.contentData.title || '').substring(0, 40) + '"',
            'target:', ad.targetUrl);

          // Send to background for registration (dedup, validation, storage)
          chrome.runtime.sendMessage({
            what: 'registerAd',
            ad: ad
          }).catch(err => {
            console.warn('[ADN Parser] Failed to send ad:', err);
          });
        }
      });
    } catch (error) {
      console.error('[ADN Parser] Error processing elements:', error);
    }
  }
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processElements);
  } else {
    processElements();
  }
  
  // Also run periodically for dynamic content
  setInterval(processElements, 5000);
  
  // Observe DOM changes
  const observer = new MutationObserver((mutations) => {
    // Debounce: only process after 500ms of no mutations
    clearTimeout(observer.timer);
    observer.timer = setTimeout(processElements, 500);
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  
  console.log('[ADN Parser] Ready and observing DOM');
})();