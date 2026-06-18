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

// watch: fswatch - o - r src / js / | xargs - n1 - I{ } ./tools/make - chromium.sh

/* global vAPI, µb */

'use strict';

import µb from '../background.js';
import { staticFilteringReverseLookup } from '../reverselookup.js';
import staticNetFilteringEngine from '../static-net-filtering.js'
import { broadcast } from '../broadcast.js';

import dnt from './dnt.js'

import {
  domainFromHostname,
  hostnameFromURI
} from '../uri-utils.js';

import {
  CompiledListWriter,
} from '../static-filtering-io.js';

import * as sfp from '../static-filtering-parser.js';

import {
  log,
  warn,
  err, 
  logNetAllow,
  logNetBlock,
  logNetEvent
} from './log.js';

import { i18n$ } from '../i18n.js';

import {
  DNTAllowed,
  DNTHideNotClick,
  DNTClickNotHide,
  DNTNotify,
  addNotification,
  removeNotification,
  hasDNTNotification,
  ShowAdsDebug,
  OperaSetting,
  FirefoxSetting,
  AdBlockerEnabled,
  AdNauseamTxt,
  EasyList,
  BlockingDisabled,
  ClickingDisabled,
  HidingDisabled,
  NewerVersionAvailable,
  OpenLetter
} from './notifications.js';

import {
  byField,
  trimChar,
  toBase64Image,
  b64toBlob,
  type,
  computeHash,
  parseHostname,
  parseDomain,
  isValidDomain
} from './adn-utils.js';

const adnauseam = (function () {
  'use strict';

  // for debugging only
  let // all visits will fail
    failAllVisits = 0,
    // start with zero ads
    clearAdsOnInit = 0,
    // reset all ad visit data
    clearVisitData = 0,
    // testing ['selenium' or 'sessbench']
    automatedMode = 0,
    // don't wait for user to be idle
    disableIdler = 0;

  let lastActivity = 0;
  let lastUserActivity = 0;
  let lastStorageUpdate = 0;
  let xhr, idgen, admap, listsLoaded = false;
  let inspected, listEntries, devbuild, adsetSize = 0;

  const production = 1;
  const notifications = [];
  const allowedExceptions = [];
  const visitedURLs = new Set();
  const maxAttemptsPerAd = 3;
  const visitTimeout = 20000;
  const pollQueueInterval = 5000;
  const redactMarker = '********';
  const repeatVisitInterval = Number.MAX_VALUE;
  const updateStorageInterval = 1000 * 60 * 30; // 30min

  // properties set to true for a devbuild
  const devProps = ["hidingAds", "clickingAds", "blockingMalware",
    "eventLogging", "disableClickingForDNT", "disableHidingForDNT"]

  // blocks requests to/from these domains even if the list is not in enabledBlockLists
  const allowAnyBlockOnDomains = ['youtube.com', 'funnyordie.com']; // no dnt in here

  // allow blocks only from this set of lists (recheck this)
  const enabledBlockLists = [
    'uBlock filters – Badware risks', 'uBlock filters – Unbreak', 
    'Malware domains', 'Malware Domain List','Anti-ThirdpartySocial', 
    'AdNauseam filters', 'Spam404', 'Anti-Adblock Killer | Reek',
    'Fanboy’s Social Blocking List', 'Malware domains (long-lived)',
    'Adblock Warning Removal List', 'Malware filter list by Disconnect',
    'Basic tracking list by Disconnect', 'EFF DNT Policy Whitelist', 
		'AdGuard – Cookie Notices', 'uBlock filters – Cookie Notices'
  ];

  const removableBlockLists = ['hphosts', 'mvps-0', 'plowe-0'];

  const reSpecialChars = /[\*\^\t\v\n]/, remd5 = /[a-fA-F0-9]{32}/;

  /**************************** functions ******************************/

  /* called when the addon is first loaded */
  const initialize = function (ads) {

    // modify XMLHttpRequest to store original request/ad
    const XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {

      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    initializeState(ads);

    log("INITIALIZE", browser.runtime.getManifest());

    setTimeout(pollQueue, pollQueueInterval * 2);
  };

  const initializeState = function (ads) {

    admap = (ads.admap ? ads.admap : ads) || {};
    adsetSize = adCount();

    validateAdStorage();

    if (production) { // disable all test-modes if production

      failAllVisits = clearVisitData = automatedMode = clearAdsOnInit = disableIdler = 0;

    } else if (automatedMode === 'sessbench') { // using sessbench

      setupTesting();
    }
  }

  const setupTesting = function () {

    warn('AdNauseam/sessbench: eid=' + chrome.runtime.id);

    chrome.runtime.onMessageExternal.addListener(
      function (request, sender, sendResponse) {

        if (request.what === 'getAdCount') {
          const url = request.pageURL,
            count = currentCount(),
            json = {
              url: url,
              count: count
            };

          console.log('[ADN] TESTING: ', JSON.stringify(json));

          sendResponse({
            what: 'setPageCount',
            pageURL: url,
            count: count
          });

        } else if (request.what === 'clearAds') {
          clearAds();
        }
      });
  }

  /* make sure we have no bad data in ad storage */
  const validateAdStorage = function () {

    let ads = adlist(), i = ads.length;

    if (clearAdsOnInit) {

      setTimeout(function () {

        warn("[DEBUG] Clearing all ad data!");
        clearAds();

      }, 2000);
    }

    if (clearVisitData) clearAdVisits(ads);

    while (i--) {

      if (!validateFields(ads[i])) {

        warn('Invalid ad in storage', ads[i]);
        ads.splice(i, 1);
      }
    }

    validateHashes();
    removePrivateAds();
    computeNextId(ads = adlist());

    log('[INIT] Initialized with ' + ads.length + ' ads');
  }

  const validMD5 = function (s) {

    return remd5.test(s);
  };

  const validateHashes = function () {
    let hashes;
    let ad;
    const pages = Object.keys(admap);
    const unhashed = [];
    const orphans = [];

    /* ForEach pageKey in admap
      if (pageKey is not hashed)
        add pageKey to unhashed
        add all its ads to orpans
      if (pageKey is hashed)
        add any non-hashed ads to orphans
    }*/
    const checkHashes = function () {

      for (let i = 0; i < pages.length; i++) {

        const isHashed = validMD5(pages[i]);

        if (!isHashed) {

          unhashed.push(pages[i]);
          hashes = Object.keys(admap[pages[i]]);
          for (let j = 0; j < hashes.length; j++) {

            ad = admap[pages[i]][hashes[j]];
            orphans.push(ad);
          }

        } else {

          hashes = Object.keys(admap[pages[i]]);
          for (let j = hashes.length - 1; j >= 0; j--) {

            if (!validMD5(hashes[j])) {

              ad = admap[pages[i]][hashes[j]];
              delete admap[pages[i]][hashes[j]];
              orphans.push(ad);
            }
          }
        }
      }

      /* if (found unhashed or orphans)
        Delete unhashed entries from admap
        Add each orphan back to admap
      */
      const repairHashes = function () {

        orphans.forEach(function (ad) {
          createAdmapEntry(ad, admap)
        });

        unhashed.forEach(function (k) {
          delete admap[k]
        });

      };

      if (unhashed.length || orphans.length) repairHashes();
    };

    checkHashes();
    //log('[CRYPT] '+adCount()+ ' ads hash-verified');
  }

  const clearAdVisits = function (ads) { // for dev-debugging only

    warn("[WARN] Clearing all Ad visit data!");

    ads = ads || adlist();

    ads.forEach(function (ad) {

      delete ad.noVisit; // Note: ignore click-prob & assume all ads should be re-visited
      delete ad.resolvedTargetUrl;
      ad.attemptedTs = 0;
      ad.visitedTs = 0;
      ad.attempts = 0
    });
  }

  // compute the highest id still in the admap
  const computeNextId = function (ads) {

    ads = ads || adlist();
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) {
        return ad ? ad.id : -1;
      }))));
  }

  const pollQueue = function (interval) {
    interval = interval || pollQueueInterval;
    markActivity();

    // changes for #1657
    //const pending = pendingAds();
    const settings = µb.userSettings;
    const hasClickInclusions = !settings.clickingAds && (settings.clickingExceptions || '').trim();
    if (/*pending.length && */(settings.clickingAds || hasClickInclusions) && !isAutomated()) { // no visits if automated

      // check whether an idle timeout has been specified
      const idleMs = disableIdler ? 0 : settings.clickOnlyWhenIdleFor;
      if (!idleMs || (millis() - lastUserActivity > idleMs)) {

        //idleMs && log("[IDLER] "+(millis() - lastUserActivity)+"ms, clicking resumed...");
        let next;
        if (visitPending(inspected)) {
          // if an unvisited ad is being inspected, visit it next
          next = inspected;
        } else {
          // else we pick the next ad needing a visit
          next = nextPending();
        }
        next != undefined && visitAd(next);
      }
      else if (idleMs) {
        log('[IDLER] ' + (millis() - lastUserActivity) + 'ms, waiting until ' + idleMs + 'ms...'); // TMP
      }
    }
    // next poll
    //setTimeout(pollQueue, Math.max(1, interval - (millis() - lastActivity)));
    setTimeout(pollQueue, Math.max(interval / 2, interval - (millis() - lastActivity)));
  }

  const markActivity = function () {
    return (lastActivity = millis());
  }

  const nextPending = function () {
    let ads = adlist();

    // @SALLY: if we sort here newer ads are visited first ?
    //ads = ads.sort(byField('-foundTs'));

    for (let i = 0; i < ads.length; i++) {
      if (visitPending(ads[i])) return ads[i];
    }
  }

  const pendingAds = function () {
    return adlist().filter(function (a) {
      return visitPending(a);
    });
  }

  const isClickingAllowedOnDomain = function (domain) {
    const exceptions = (µb.userSettings.clickingExceptions || '').trim();
    if (!exceptions) return µb.userSettings.clickingAds;
    const domains = exceptions.split(/\s+/).filter(Boolean);
    const isInList = domains.some(function (d) {
      return domain === d || domain.endsWith('.' + d);
    });
    if (µb.userSettings.clickingAds) {
      // Toggle ON: list is exclusion (click everywhere except listed)
      return !isInList;
    } else {
      // Toggle OFF: list is inclusion (only click on listed)
      return isInList;
    }
  }

  const visitPending = function (ad) {
    let pending = ad && ad.attempts < maxAttemptsPerAd &&
      ad.visitedTs <= 0 && !ad.dntAllowed && !ad.noVisit;
    if (pending && visitedURLs.has(ad.targetUrl)) {
      log('[NOVISIT] User has already clicked the ad', ad.targetUrl);
      ad.noVisit = true; // so we don't recheck it
      ad.clickedByUser = true;
      pending = false;
    }
    return pending;
  }

  const isPopupOpen = function () {
    return vAPI.getViews({ type: "popup" }).length;
  };

  const getExtPageTabId = function (htmlPage) {
    const pageUrl = vAPI.getURL(htmlPage);
    for (let e of µb.pageStores) {
      const pageStore = e[1];
      if (pageStore !== null && pageStore.rawURL.startsWith(pageUrl))
        return pageStore.tabId;
    }
  };

  const updateAdOnFailure = function (xhr, e) {

    const ad = xhr.delegate;

    if (ad && ad.visitedTs <= 0) { // make sure we haven't visited already

      // update the ad
      ad.visitedTs = -millis();

      if (!ad.errors) ad.errors = [];
      ad.errors.push(xhr.status + ' (' +
        xhr.statusText + ')' + (e ? ' ' + e.type : ''));

      if (ad.attempts >= maxAttemptsPerAd) {

        log('[FAILED] ' + adinfo(ad), ad); // this);
        if (ad.title === 'Pending') ad.title = 'Failed';
      }

      broadcast({
        what: 'adVisited',
        ad: ad
      });

    } else {

      err("No Ad in updateAdOnFailure()", xhr, e);
    }
  };

  /* send to vault/menu/dashboard if open */
  const sendNotifications = function (notes) {

    broadcast({
      what: 'notifications',
      notifications: notes
      // TODO: do we need to make these cloneable ? see #1163
    });
  };

  const parseTitle = function (xhr) {

    const html = xhr.responseText;
    let title = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    if (title && title.length > 1) {
      return unescapeHTML(title[1].trim());
    }

    const shtml = html.length > 100 ? html.substring(0, 100) + '...' : html;
    warn('[VISIT] No title for ' + xhr.requestUrl, 'Html:\n' + shtml);

    return false;
  };

  const updateAdOnSuccess = async function (xhr, ad, title) {

    ad = xhr.delegate;

    if (ad) {

      if (title && ad.title === 'Pending') ad.title = title;

      if (ad.title === 'Pending')
        ad.title = parseDomain(xhr.requestUrl, true);

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      const tab = await vAPI.tabs.getCurrent();

      if (tab && tab.id) { // do click animation
        const tabId = tab.id;
        µb.updateToolbarIcon(tabId, 0b0111, true); // click icon
      }
      // else warn('Null tab in click animation: ', tab); // not a problem

      broadcast({
        what: 'adVisited',
        ad: ad
      });

      if (ad === inspected) inspected = null;

      log('[VISIT] ' + adinfo(ad), ad.title);
    }

    storeAdData();
  };

  // returns the current active visit attempt or null
  const activeVisit = function (pageUrl) {

    if (xhr && xhr.delegate) {
      if (!pageUrl || xhr.delegate === pageUrl)
        return xhr.delegate;
    }
  };

  const onVisitError = function (e) {
    if (this == undefined) return;
    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    // Is it a timeout?
    if (e.type === 'timeout') {

      warn('[TIMEOUT] Visiting ' + this.requestUrl); //, e, this);

    } else {

      // or some other error?
      warn('onVisitError()', e, this.requestUrl, this.statusText); // this);
    }

    if (!this.delegate) {

      return err('Request received without Ad: ' + this.responseURL);
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  const onVisitResponse = function () {

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    const ad = this.delegate;

    if (!ad) {

      return err('Request received without Ad: ' + this.responseURL);
    }

    if (!ad.id) {

      return warn("Visit response from deleted ad! ", ad);
    }

    ad.attemptedTs = 0; // reset as visit no longer in progress

    const status = this.status || 200, html = this.responseText;

    if (failAllVisits || status < 200 || status >= 300) {
      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    try {

      if (!isFacebookExternal(this, ad)) {

        updateAdOnSuccess(this, ad, parseTitle(this));
      }

    } catch (e) {

      warn(e.message);
    }

    xhr = null; // end the visit
  };

  // Checks for external FB link and if so, parses the true link
  const isFacebookExternal = function (xhr, ad) {

    if (/facebook\.com\/l\.php/.test(xhr.requestUrl)) {

      const url = decodeURIComponent(xhr.responseURL);
      ad.parsedTargetUrl = decodeURIComponent(url.substring(url.lastIndexOf('http')));
      log("[FB-EXT] Parsed: ", ad.parsedTargetUrl);

      return true;
    }
  };

  const visitAd = function (ad) {

    function timeoutError(xhr) {
      return onVisitError.call(xhr, {
        type: 'timeout'
      });
    }

    const url = ad && ad.targetUrl, now = markActivity();

    // tell menu/vault we have a new attempt
    broadcast({
      what: 'adAttempt',
      ad: ad
    });

    if (xhr) {

      if (xhr.delegate.attemptedTs) {

        const elapsed = (now - xhr.delegate.attemptedTs);

        // TODO: why does this happen... a redirect?
        warn('[TRYING] Attempt to reuse xhr from ' + elapsed + " ms ago");

        if (elapsed > visitTimeout)
          timeoutError();
      }
      else {

        warn('[TRYING] Attempt to reuse xhr with no attemptedTs!!', xhr);
      }
    }

    ad.attempts++;
    ad.attemptedTs = now;

    if (!validateTarget(ad)) return deleteAd(ad);

    return sendXhr(ad);
    // return openAdInNewTab(ad);
    // return popUnderAd(ad)
  };

  const sendXhr = function (ad) {

    // if we've parsed an obfuscated target, use it
    const target = ad.parsedTargetUrl || ad.targetUrl;

    log('[TRYING] ' + adinfo(ad), ad.targetUrl);

    xhr = new XMLHttpRequest();

    try {
      xhr.open('get', target, true);
      xhr.withCredentials = true;
      xhr.delegate = ad;
      xhr.timeout = visitTimeout;
      xhr.onload = onVisitResponse;
      xhr.onerror = onVisitError;
      xhr.ontimeout = onVisitError;
      xhr.responseType = ''; // 'document'?;
      xhr.send();
    } catch (e) {
      onVisitError.call(xhr, e);
    }
  }

  const storeAdData = function (immediate) {
    // always update store as long as adsetSize is less than 1000
    if (adsetSize < 1000) immediate = true;

    const now = millis();
    // defer if we've recently written and !immediate
    if (immediate || (!immediate && now - lastStorageUpdate > updateStorageInterval)) {
      vAPI.storage.set({ admap: admap });
      µb.changeUserSettings('admap', admap); 
      lastStorageUpdate = millis();
      //log("--Storage Ad Data--")
    }
  }

  const validateTarget = function (ad) {

    const url = ad.targetUrl;

    if (!/^http/.test(url)) {

      // Here we try to extract an obfuscated URL
      const idx = url.indexOf('http');
      if (idx != -1) {

        ad.targetUrl = decodeURIComponent(url.substring(idx));
        log("Ad.targetUrl updated: " + ad.targetUrl);

      } else {

        return warn("Invalid targetUrl: " + url);
      }
    }

    // ad.targetUrl = trimChar(ad.targetUrl, '/'); #751

    const dInfo = domainInfo(ad.resolvedTargetUrl || ad.targetUrl);

    if (!isValidDomain(dInfo.domain)) {

      return warn("Invalid domain: " + url);
    }

    ad.targetHostname = dInfo.hostname;
    ad.targetDomain = dInfo.domain;

    // Check: a slash at the end of the domain https://github.com/dhowe/AdNauseam/issues/1304

    const idx = url.indexOf(ad.targetDomain) + ad.targetDomain.length;
    if (idx < url.length - 1 && url.charAt(idx) != "/") {
      ad.targetUrl = url.substring(0, idx) + "/" + url.substring(idx, url.length);
    }

    return true;
  }

  const domainInfo = function (url) { // via uBlock/psl

    const hostname = hostnameFromURI(url);
    const domain = domainFromHostname(hostname);
    return { hostname: hostname, domain: domain };
  }

  const domainFromURI = function (url) { // TODO: replace all uses with domainInfo()

    return domainFromHostname(hostnameFromURI(url));
  };

  const validateFields = function (ad) {

    if (ad.visitedTs === 0 && ad.attempts > 0) {

      warn('Invalid visitTs/attempts pair', ad);
      ad.attempts = 0; // shouldn't happen
    }

    if (!(ad.pageUrl.startsWith('http') || ad.pageUrl === redactMarker))
      warn('Possibly Invalid PageUrl: ', ad.pageUrl);

    // re-add if stripped in export
    ad.pageDomain = ad.pageDomain || domainFromURI(ad.pageUrl) || ad.pageUrl;
    ad.targetDomain = ad.targetDomain || domainFromURI(ad.resolvedTargetUrl || ad.targetUrl);
    ad.targetHostname = ad.targetHostname || hostnameFromURI(ad.resolvedTargetUrl || ad.targetUrl);

    return ad && type(ad) === 'object' &&
      type(ad.pageUrl) === 'string' &&
      type(ad.contentType) === 'string' &&
      type(ad.contentData) === 'object';
  }

  const validate = function (ad) {

    if (!validateFields(ad)) {

      return warn('Invalid ad-fields: ', ad);
    }

    const cd = ad.contentData, ct = ad.contentType, pu = ad.pageUrl;

    ad.title = unescapeHTML(ad.title); // fix to #31

    // Reject titles that look like JavaScript/CSS code
    if (ad.title && (/^(var|let|const|function)\s/.test(ad.title) || (ad.title.match(/;/g) || []).length >= 2)) {
      ad.title = parseDomain(ad.targetUrl, true) || 'Pending';
    }

    if (ct === 'text') {

      cd.title = unescapeHTML(cd.title);
      cd.text = unescapeHTML(cd.text);

    } else if (ct === 'img') {

      if (!/^http/.test(cd.src) && !/^data:image/.test(cd.src)) {

        if (/^\/\//.test(cd.src)) {

          cd.src = 'http:' + cd.src;

        } else {

          log("Relative-image: " + cd.src);
          cd.src = pu.substring(0, pu.lastIndexOf('/')) + '/' + cd.src;
          log("    --> " + cd.src);
        }
      }

    } else {

      warn('Invalid ad type: ' + ct);
    }

    return validateTarget(ad);
  };

  const clearAdmap = function () {

    const pages = Object.keys(admap);

    for (let i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {

        const hashes = Object.keys(admap[pages[i]]);

        for (let j = 0; j < hashes.length; j++) {

          delete admap[pages[i]][hashes[j]];
        }
      }

      delete admap[pages[i]];
    }

    admap = {}; // redundant, remove
  };
  
  const purgeDeadAdsAdmap = function (deadAds) {
    let deadIds = deadAds.map(deadad => deadad.children.map(c => c.id)[0])
    const pages = Object.keys(admap);
    for (let i = 0; i < pages.length; i++) {
      if (admap[pages[i]]) {
        const hashes = Object.keys(admap[pages[i]]);
        for (let j = 0; j < hashes.length; j++) {
          let ad = admap[pages[i]][hashes[j]];
          if (deadIds.includes(ad.id)) {
            delete admap[pages[i]][hashes[j]];
          }
        }
      }
      if (admap[pages[i]].length < 1) {
        delete admap[pages[i]];
      }
    }
  }

  const millis = function () {

    return +new Date();
  }

  const adinfo = function (ad) {

    const id = ad.id || '?';
    return 'Ad#' + id + '(' + ad.contentType + ')';
  }

  const unescapeHTML = function (s) { // hack

    if (s && s.length) {
      const entities = [
        '#0*32', ' ',
        '#0*33', '!',
        '#0*34', '"',
        '#0*35', '#',
        '#0*36', '$',
        '#0*37', '%',
        '#0*38', '&',
        '#0*39', '\'',
        'apos', '\'',
        'amp', '&',
        'lt', '<',
        'gt', '>',
        'quot', '"',
        '#x27', '\'',
        '#x60', '`'
      ];

      for (let i = 0; i < entities.length; i += 2) {
        s = s.replace(new RegExp('\&' + entities[i] + ';', 'g'), entities[i + 1]);
      }
    }

    return s;
  }

  const adById = function (id) {

    const list = adlist();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id)
        return list[i];
    }
  };

  const reloadExtPage = function (htmlPage) {

    const tabId = getExtPageTabId(htmlPage);
    tabId && vAPI.tabs.reload(tabId);
  };

  const deleteAd = function (arg) {

    const ad = type(arg) === 'object' ? arg : adById(arg), count = adCount();

    if (!ad) {
      return warn("No Ad to delete", id, admap);
    }

    const pageHash = YaMD5.hashStr(ad.pageUrl);
    if (admap[pageHash]) {

      if (pageHash == YaMD5.hashStr("")) {
        // private ads, remove all private ads because it's impossible to select each private ad
        delete admap[pageHash];
      } else {
        const hash = computeHash(ad);

        if (admap[pageHash][hash]) {

          delete admap[pageHash][hash];

        } else {

          return warn('Delete failed, no ad: ', ad, admap);
        }

      }
    }
    else {
      return warn('Delete failed, no page key: ', ad, admap);
    }

    if (adCount() < count) {

      log('[DELETE] ' + adinfo(ad));
      updateBadges();

    } else {

      return warn('Unable to delete: ', ad);
    }

    adsetSize--;
    storeAdData();
  }

  const deadAd = function (ad, setDead) {
    console.log("deadAd", ad)
    if (!ad) {
      return warn("No Ad to set Dead", id, admap);
    }

    const pageHash = YaMD5.hashStr(ad.pageUrl);
    if (pageHash !== YaMD5.hashStr("")) {
      const hash = computeHash(ad);
      if (admap[pageHash][hash]) {
        let addata = admap[pageHash][hash];
        if(setDead) { // set ad as dead
          if (admap[pageHash][hash]["dead"]) {
            admap[pageHash][hash]["dead"] = parseInt(admap[pageHash][hash]["dead"]) + 1;
          } else {
            admap[pageHash][hash]["dead"] = 1;
          }
        } else { // set as not dead
          admap[pageHash][hash]["dead"] = 0;
        }
        storeAdData();
      }
    }
  }

  const adsForUI = function (pageUrl) {
    return {
      data: adlist(pageUrl, false, true),
      pageUrl: pageUrl,
      prefs: contentPrefs(),
      current: activeVisit(),
      notifications: notifications
    };
  };

  const validateImport = function (map, replaceAll) {
    if (type(map) !== 'object')
      return false;

    let pass = 0;
    const newmap = replaceAll ? {} : admap;
    const pages = Object.keys(map);

    for (let i = 0; i < pages.length; i++) {

      if (type(map[pages[i]]) !== 'object')
        return false;

      computeNextId();
      const hashes = Object.keys(map[pages[i]]);
      for (let j = 0; j < hashes.length; j++) {

        const hash = hashes[j];
        if (type(hash) !== 'string' || !(validMD5(hash) || hash.includes('::'))) {

          return warn('Bad hash in import: ', hash, ad); // tmp
        }

        let ad = map[pages[i]][hash];
        if (validateFields(ad)) {

          validateTarget(ad); // accept either way
          ad.id = ++idgen; // increment the id so as not to collide

          if (!newmap[pages[i]]) newmap[pages[i]] = {};
          newmap[pages[i]][hash] = ad;

          pass++;

        } else {

          warn('Invalid ad in import: ', ad); // tmp
        }
      }
    }

    return pass ? newmap : false;
  };

  const validateAdArray = function (ads, replaceAll) {

    const map = replaceAll ? {} : admap;

    for (let j = 0; j < ads.length; j++) {

      const ad = updateLegacyAd(ads[j]);
      createAdmapEntry(ad, map)
    }

    return map;
  };

  const createAdmapEntry = function (ad, map) {

    if (validateFields(ad)) {

      const pagehash = YaMD5.hashStr(ad.pageUrl);
      if (!map[pagehash]) map[pagehash] = {};
      map[pagehash][computeHash(ad)] = ad;
      return true;
    }

    warn('Unable to validate ad', ad);
  }

  const validateLegacyImport = function (map) {
    if (type(map) !== 'object') {

      return (type(map) === 'array') ? validateAdArray(map) :
        warn('Import-fail: not object or array', type(map), map);
    }

    let ad;
    let ads;
    let hash;
    const newmap = {};
    const pages = Object.keys(map);

    if (!pages || !pages.length) {

      return warn('no pages: ', pages);
    }

    for (let i = 0; i < pages.length; i++) {

      ads = map[pages[i]];

      if (type(ads) !== 'array') {

        //warn('not array', type(ads), ads);
        return false;
      }

      newmap[pages[i]] = {};

      for (let j = 0; j < ads.length; j++) {

        ad = updateLegacyAd(ads[j]);
        hash = computeHash(ad);

        if (!validateFields(ad)) {

          warn('Unable to validate legacy ad', ad);
          continue;
        }

        newmap[pages[i]][hash] = ad;

        //log('converted ad', newmap[pages[i]][hash]);
      }
    }

    return newmap;
  };

  const updateLegacyAd = function (ad) {

    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.version = vAPI.app.version;
    ad.attempts = ad.attempts || 0;
    ad.pageDomain = domainFromURI(ad.pageUrl) || ad.pageUrl; // DCH: 8/10
    if (!ad.errors || !ad.errors.length)
      delete ad.errors;
    delete ad.hashkey;
    delete ad.path;

    return ad;
  }

  const postRegister = function (ad, tabId) {

    log('[FOUND] ' + adinfo(ad), ad);

    // broadcast the new ad to vault/menu if open
    const json = adsForUI(ad.pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    log('[BROADCAST] adDetected', adinfo(ad));
    broadcast(json);

    if (µb.userSettings.showIconBadge)
      µb.updateToolbarIcon(tabId);

    storeAdData();
  };

  const activeBlockList = function (test) {
    // either from the enabledBlockedLists, or if it matches "My Filter". \
    // OR added because of previous where "My Filters" didn't match the other language names this value can have
    // https://github.com/dhowe/AdNauseam/issues/1914
    return enabledBlockLists.contains(test) || test === i18n$('1pPageName');
  };

  // check target domain against page-domain #337
  const internalTarget = function (ad) {

    if (ad.contentType === 'text') return false;

    // if an image ad's page/target domains match, it's internal
    return (ad.pageDomain === ad.targetDomain);
  };

  const listsForFilter = function (filter) {
    const lists = {};
    if (filter == null) return lists;
    let entry;
    let content;
    let pos;
    let c;

    const writer = new CompiledListWriter();
    const parser = new sfp.AstFilterParser({
      expertMode: true,
      nativeCssHas: vAPI.webextFlavor.env.includes('native_css_has'),
      maxTokenLength: staticNetFilteringEngine.MAX_TOKEN_LENGTH,
    });
    parser.parse(filter.raw);

    const compiler = staticNetFilteringEngine.createCompiler(parser);
    if ( compiler.compile(parser, writer) === false ) { return; }

    const compiledFilter = writer.last();

    for (const path in listEntries) {

      entry = listEntries[path];
      if (entry === undefined) {
        continue;
      }

      content = entry.content;
      if (content === undefined) {
        continue;
      }
      pos = content.indexOf(compiledFilter);
      if (pos === -1) {
        continue;
      }
      // We need an exact match.
      // https://github.com/gorhill/uBlock/issues/1392
      if (pos !== 0 && reSpecialChars.test(content.charAt(pos - 1)) === false) {
        continue;
      }

      // https://github.com/gorhill/uBlock/issues/835
      c = content.charAt(pos + compiledFilter.length);
      if (c !== '' && reSpecialChars.test(c) === false) {
        continue;
      }

      if (lists[entry.title] == undefined) {
        lists[entry.title] = compiledFilter;
      }

    }
    return lists;
  };

  // TODO: need to handle domain-specific blocks
  const isStrictBlock = function (result, context) {

    // see https://github.com/dhowe/AdNauseam/issues/1801#issuecomment-816271511
    if (µb.userSettings.strictBlockingMode) {
      logNetBlock('GlobalStrict', context.docDomain + ' :: ' + context.url);
      return true;
    }
    else if (result === 4) { // never gets here
      logNetBlock('LocalStrict', context.docDomain + ' :: ' + context.url);
      return true;
    }
  }

  /* not using anymore since https://github.com/dhowe/AdNauseam/issues/2036

  const isBlockableDomain = function (result, context) {
    const domain = context.docDomain, host = context.getHostname();
    for (let i = 0; i < allowAnyBlockOnDomains.length; i++) {
      const dom = allowAnyBlockOnDomains[i];
      if (dom === domain || host.indexOf(dom) > -1) {
        return true;
      }
    }
    return false;
  
  };
  */

  /**
   *  This is called AFTER our DNT rules, and checks the following cases.
   *
   *  If this function returns true, then the request will be marked as ADN-allowed (?)
   *
   *  1) whether we are blocking at all (blockingMalware == false)
   *  		if not, return false
   *
   *  2) Whether we are have finished loading rules (listsLoaded == true)
   *      if not, return false
   *
   *  3) whether the request is strictBlocked (iff strictBlocking is enabled)
   *      if so, return true;
   *      A) If global Strict Block is enabled OR the request is blocked by net rules.
   *      B) If request domain/page is in the StrictBlockList
   *
   *  4) check if any list it was found on allows blocks
   *  	A) user list:      block
   *    B) exception hit:  allow
   *    C) block hit:      block
   *    D) no valid hits:  allow, but no cookies later (see checkAllowedException)
   */
  const isBlockableRequest = function (result, context) {

    if (µb.userSettings.blockingMalware === false) {
      logNetAllow('NoBlock', context.docDomain + ' :: ' + context.url); // 1.
      return false;
    }

    if (!listsLoaded) {
      logNetAllow('Loading', context.docDomain + ' :: ' + context.url); // 2.
      return false;
    }
    
    if (isStrictBlock(result, context)) {                               // 3.A
      logNetBlock('Global Strict Block');
      return true;
    }
    
    // Check if specific page is strict-blocked by the StrictBlockList
    var getIsPageStrictBlocked = µb.getIsPageStrictBlocked(context.tabOrigin)
    if (getIsPageStrictBlocked) {
      logNetBlock('From StrictBlockList', context.tabOrigin);
      return true;
    }

    ///////////////////////////////////////////////////////////////////////
    const snfe = staticNetFilteringEngine, snfeData = snfe.toLogData();

    /* Case 4 */
    const lists = listsForFilter(snfeData); // get lists that match the filter
    if (Object.keys(lists).length === 0) {                                  // 4.A
      snfeData && logNetBlock('UserList', snfeData.raw); // always block
      return true;
    }

    let misses = [];
    for (let name in lists) {
      if (activeBlockList(name)) {
        // Check if this rule is an allow-rule, if yes, then don't block
        if (lists[name].indexOf('@@') === 0) {                              // 4.B
          logNetAllow(name, snfeData.raw, context.url);
          return false;
        }
        // this a block rule from a blockEnabledList, so we don't need to block the cookies ourselves, uBlock already does that
        logNetBlock(name, snfeData.raw, context.url);                       // 4.C
        return true; // blocked, no need to continue
      }
      else {
        if (!misses.contains(name)) misses.push(name); // [save misses for 4.D]
      }
    }
    // Adds the request url to the allowedExceptions list, later used to know which cookies need to be block by AdNauseam
    // always returns false since it is allowed 
    return adnAllowRequest(misses.join(','), snfeData.raw, context.url);    // 4.D
  };

  const adCount = function () {
    return adlist().length;
  }

  const dntAllowsRequest = function (url, hostname) {

    const us = µb.userSettings, dntHides = us.hidingAds && us.disableHidingForDNT,
      dntClicks = us.clickingAds && us.disableClickingForDNT;

    // 1st-party: only check original-request per EFF spec
    return ((dntHides || dntClicks) && us.dntDomains.contains(hostname));
  };

  // see https://github.com/dhowe/AdNauseam/wiki/Developer-FAQ#how-does-adnauseam-handle-incoming-and-outgoing-cookies
  const adnAllowRequest = function (msg, raw, url) {

    // Note: need to store allowed requests here so that we can
    // block any incoming cookies later (see #301)
    allowedExceptions[url] = +new Date();

    if (true || msg !== 'EasyList') {  // avoid excessive logging (TODO: remove 'true')
      logNetEvent('[ALLOW!]', msg, raw + ': ', url);
    }

    return false;
  }

  const isAutomated = function () {

    return (automatedMode && automatedMode.length);
  }

  const saveVaultImages = function (jsonName) {
    // Note(not-in-use): crashes over approx. 725 image or 70MB

    const imgURLs = [];
    adlist().forEach(function (ad) {
      if (ad.contentType === 'img')
        imgURLs.push(ad.contentData.src);
    });

    // #639: download to a folder next to the export file (with same name -json)

    const files = [];

    let lastFilesLength = 0;
    const zipNameParts = jsonName.split(".");
    const zipName = zipNameParts.splice(0, zipNameParts.length - 2).join('_');

    const processUrl = function (url) {
      const parts = url.split("/");
      let filename = parts[parts.length - 1];

      filename = "image_" + i + ".jpg"; // tmp

      const img = new Image();
      img.onload = function () {

        //better image handling
        if ('naturalHeight' in this) {
          if (this.naturalHeight + this.naturalWidth === 0) {
            this.onerror();
            return;
          }
        } else if (this.width + this.height === 0) {
          this.onerror();
          return;
        }

        const a = document.createElement('a');
        a.href = this.src;
        files.push({
          name: filename,
          data: toBase64Image(img)
        });
      }

      img.onerror = function () {
        log("Error");
        const index = imgURLs.indexOf(url);
        if (index > -1) {
          imgURLs.splice(index, 1);
        }
      }

      img.src = url;
    };

    imgURLs.forEach(processUrl);

    const check = setInterval(function () {

      log("checking", files.length, imgURLs.length, lastFilesLength);

      if (files.length === imgURLs.length || files.length === lastFilesLength) {

        clearInterval(check);

        const zip = new JSZip(), img = zip.folder(zipName), zipcount = 0;

        for (let i = 0; i < files.length; i++) {
          img.file(files[i].name, files[i].data, {
            base64: true
          });
        }

        // type base64 or blob???
        zip.generateAsync({
          type: "base64"
        }).then(function (content) {

          const blob = b64toBlob(content, 'image'), blobUrl = URL.createObjectURL(blob);

          //use vAPI.download, convert base64 to blob
          vAPI.download({
            'url': blobUrl,
            'filename': zipName + ".zip"
          });
        });
      }
      lastFilesLength = files.length;
    }, 1000);
  };

  const admapToJSON = function (sanitize) {

    const // deep clone
      map = JSON.parse(JSON.stringify(admap)),
      pages = Object.keys(map);

    for (let i = 0; i < pages.length; i++) {

      if (map[pages[i]]) {
        const hashes = Object.keys(map[pages[i]]);
        for (let j = 0; j < hashes.length; j++) {

          const ad = map[pages[i]][hashes[j]];

          delete ad.current;
          delete ad.pageDomain;
          delete ad.targetDomain;
          delete ad.targetHostname;

          if (ad.resolvedTargetUrl === ad.targetUrl)
            delete ad.resolvedTargetUrl;

          if (sanitize) { // #643: remove page info for privacy

            ad.pageUrl = redactMarker;  // YaMD5.hashStr(ad.pageUrl);
            ad.pageTitle = redactMarker; // YaMD5.hashStr(ad.pageTitle);
          }
        }
      }
    }
    return JSON.stringify(map, null, 2);
  };

  const removePrivateAds = function () {
    if (!µb.userSettings.removeAdsInPrivate) { return; }
    let removed = [];
    const pages = Object.keys(admap);
    for (let i = 0; admap && i < pages.length; i++) {
      const page = pages[i];
      // skip private ads hash
      if (page == YaMD5.hashStr("")) continue;
      if (admap[page]) {
        const hashes = Object.keys(admap[page]);
        for (let j = 0; j < hashes.length; j++) {
          const ad = admap[page][hashes[j]];
          if (ad.private == true) {
            // clear data & relocate to a new bin?
            removed.push(ad);
            const newAdHash = computeHash(ad, true);
            ad.contentData = {}
            ad.title = "";
            ad.pageTitle = "";
            ad.pageUrl = "";
            ad.resolvedTargetUrl = "";
            ad.requestId = "";
            ad.adNetwork = ad.targetUrl && parseHostname(ad.targetUrl);
            ad.targetUrl = "";

            const privatePageHash = YaMD5.hashStr("");
            if (admap[privatePageHash] == undefined) {
              admap[privatePageHash] = {}
            }
            admap[privatePageHash][newAdHash] = ad;
            delete admap[pages[i]][hashes[j]];
          }
        }
      }
    }
    if (removed.length > 0) {
      //log("Removing private ad", removed); 
      adsetSize -= removed;
      storeAdData(true);
    }
    return removed;
  }

  const initUserSettings = async function () {
    const settings = await vAPI.storage.get(µb.userSettings);
    // start by grabbing user-settings, then calling initialize()

    // this for backwards compatibility only ---------------------
    const mapSz = Object.keys(settings.admap).length;
    if (!mapSz && µb.adnSettings && µb.adnSettings.admap) {// Sally: do we still need this?

      settings.admap = µb.adnSettings.admap;

      log("[IMPORT] Using legacy admap...");

      setTimeout(function () {
        storeAdData(true);
      }, 2000);
    }
    const ads = await vAPI.storage.get("admap");
    initialize(ads ? ads : settings);

  }

  initUserSettings();//

  //browser.windows not supported for firefox android
  browser.windows && browser.windows.onRemoved.addListener(function (windowId) {
    removePrivateAds();
  });

  /********************************** API *************************************/

  const exports = { log };

  exports.removeBlockingLists = function (lists) {

    removableBlockLists.forEach(function (l) {
      delete lists[l];
    });
  };

  exports.adsForVault = function (request, pageStore, tabId) {
    return adsForUI();
  };

  // return true if we must allow a request in order to extract ads
  // (the request will then be logged as adn-allowed)
  exports.mustAllowRequest = function (result, context) {
    return result !== 0 && !isBlockableRequest(result, context);
  };

  exports.itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      const ad = adById(request.id);
      inspected = ad;
    }
  };

  const contentPrefs = exports.contentPrefs = function (hostname) {

    // preferences relevant to our ui/content-scripts
    const us = µb.userSettings;
    const showDnt = (us.disableHidingForDNT && us.dntDomains.contains(hostname));

    return {
      hidingDisabled: !us.hidingAds || showDnt,
      clickingDisabled: !us.clickingAds,
      textAdsDisabled: !us.parseTextAds,
      logEvents: us.eventLogging,
      devMode: us.devMode,
    };
  };

  exports.toggleEnabled = function (request, pageStore, tabId) {

    const store = µb.pageStoreFromTabId(request.tabId);
    if (store) {

      store.toggleNetFilteringSwitch(request.url, request.scope, request.state);
      µb.toggleStrictBlock(request.url, request.scope, false); // adn remove strictBlock
      updateBadges();

      // close whitelist if open (see gh #113)
      const wlId = getExtPageTabId("dashboard.html#whitelist.html");
      wlId && vAPI.tabs.replace(wlId, vAPI.getURL("dashboard.html"));

      // ADN - close strictblocklist if open
      const wlIdSb = getExtPageTabId("dashboard.html#strictblocklist.html");
      wlIdSb && vAPI.tabs.replace(wlIdSb, vAPI.getURL("dashboard.html"));
    }
  };

  // Adn - StrictBlockList
  // toggle page strictBlock
  exports.toggleStrictBlockButton = function (request) { 
    console.log("[ADN] toggleStrictBlock", request)
    const store = µb.pageStoreFromTabId(request.tabId);
    if (store) {
      // enable strict blocking for the current domain...
      µb.toggleStrictBlock(request.url, request.scope, request.state);
      // and remove the domain from the whitelist if it is there.
      store.toggleNetFilteringSwitch(request.url, request.scope, true);
      updateBadges();

      // close strictblocklist if open (see gh #113)
      const wlId = getExtPageTabId("dashboard.html#strictblocklist.html");
      wlId && vAPI.tabs.replace(wlId, vAPI.getURL("dashboard.html"));

      // close whitelist if open (see gh #113)
      const wlIdwl = getExtPageTabId("dashboard.html#whitelist.html");
      wlIdwl && vAPI.tabs.replace(wlIdwl, vAPI.getURL("dashboard.html"));
    }
  }

  // Called when new top-level page is loaded
  exports.onPageLoad = function (tabId, requestURL) {

    const ads = adlist(requestURL); // all ads for url

    log('[PAGE]', requestURL, '(' + ads.length + ' existing ads)');
    visitedURLs.add(requestURL);

    ads.forEach(function (ad) { ad.current = false; });
    if (automatedMode === 'selenium' && requestURL === 'http://rednoise.org/ad-auto-export') {
      exportAds();
    }

    markUserAction();
  };

  // called each time a single list is updated
  exports.onListUpdated = function (path, details) {
    // relasted to https://github.com/dhowe/AdNauseam/issues/2110
    // to do: change the calls of "onListUpdated" and "onListsLoaded" so this next condition is not needed
    if (listEntries == undefined) return;
    if (listEntries[path] == undefined) {
      // content, supportUrl Title
      listEntries[path] = details
    } else {
      listEntries[path].content = details.content;
    }
  }

  exports.onListsLoaded = async function (firstRun) {

    listEntries = {};
    const entries = await staticFilteringReverseLookup.initWorker();
    entries.forEach((value, key) => listEntries[key] = value);

    devbuild = vAPI.webextFlavor.soup.has('devbuild');
    listsLoaded = true;

    verifyAdBlockers();
    verifySettings();
    verifyLists();
    verifyVersion();

    // remove open letter notification
    // const modified = addNotification(notifications, OpenLetter);
    // modified && sendNotifications(notifications);

    dnt.updateFilters();

    if (firstRun) {

      listsLoaded = true;
      let url = 'firstrun.html';

      if (devbuild) {

        // use default settings for dev-builds
        url = 'dashboard.html#options.html';
        devProps.forEach(p => µb.changeUserSettings(p, true));
      }

      // open firstrun or settings page (if devbuild)
      vAPI.tabs.open({ url, index: -1 });

      // collapses 'languages' group in dashboard:3rd-party
      vAPI.localStorage.setItem('collapseGroup5', 'y');

      //if (console.clear) console.clear();

      log("[INIT] AdNauseam loaded (" + entries.size + " 3p lists)"
        + (devbuild ? ' [DEV]' : ''));
    }
  };

  const markUserAction = exports.markUserAction = function () {

    return (lastUserActivity = millis());
  }

  exports.lookupAd = function (url, requestId) {
		if (requestId) {
			const ads = adlist();
			for (let i = 0; i < ads.length; i++) {
	
				if (ads[i].attemptedTs) {
					//console.log('check: '+ads[i].requestId+'/'+ads[i].targetUrl+' ?= '+requestId+'/'+url);
					if (ads[i].requestId === requestId || ads[i].targetUrl === url) {
						return ads[i];
					}
				}
			}
		} else {
			return false; 
		}
  };

  exports.registerAd = function (request, pageStore, tabId) {
    if (!request.ad) return;

    let json, adhash, pageHash, msSinceFound, orig;
    const ad = request.ad;

    ad.current = true;
    ad.attemptedTs = 0;
    ad.pageUrl = pageStore.rawURL;
    ad.pageTitle = pageStore.title;
    ad.pageDomain = domainFromHostname(pageStore.tabHostname);
    ad.version = vAPI.app.version;

    //console.log('registerAd: '+pageStore.tabHostname+' -> '+ad.pageDomain);

    if (!validate(ad)) return warn(ad);

    if (!µb.hiddenSettings.internalLinkDomains.includes(ad.pageDomain) && internalTarget(ad)) {
      return warn('[INTERN] Ignoring Ad on ' + ad.pageDomain + ', target: ' + ad.targetUrl);
    }

    pageHash = YaMD5.hashStr(ad.pageUrl);

    if (!admap[pageHash]) admap[pageHash] = {};

    adhash = computeHash(ad);

    if (admap[pageHash][adhash]) { // may be a duplicate

      orig = admap[pageHash][adhash];
      msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {

        log('[DUPLICATE] ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen; // gets an id only if its not a duplicate

    if (dnt.mustNotVisit(ad)) { // see #1168
      ad.noVisit = true;
      ad.dntAllowed = true;
    }
    else if (!isClickingAllowedOnDomain(ad.pageDomain)) {
      ad.noVisit = true;
      ad.domainExcluded = true;
      log('[SKIP] Domain excluded from ad clicks: ' + ad.pageDomain);
    }
    else {
      ad.noVisit = Math.random() > µb.userSettings.clickProbability; // if true, ad will never be visited
    }

    // note: this will overwrite an older ad with the same key
    admap[pageHash][adhash] = ad;
    adsetSize++;

    postRegister(ad, tabId);
  };

  // update tab badges if we're showing them
  const updateBadges = exports.updateBadges = function () {
    const optionsUrl = vAPI.getURL('options.html');
    for (let [key, pageStore] of µb.pageStores.entries()) {
      if (pageStore.tabId !== -1 && !pageStore.rawURL.startsWith(optionsUrl)) {
        µb.updateToolbarIcon(pageStore.tabId);
      }
    }
  };

  /* 
   * checkAllowedException returns if the header was modified or not 
   * if the cookie was removed, it returns the modified headers to the request on adnOnHeadersRecieved
   */
  exports.checkAllowedException = function (headers, requestUrl, originalUrl) {
    // check if the requestUrl is a Adn-allowed request
    if (typeof allowedExceptions[requestUrl] !== 'undefined') {
      // if so, block the incoming cookie
      return blockIncomingCookies(headers, requestUrl, originalUrl);
    }
    return false;
  };

  /* 
   * Returns true if request headers (the incoming 'headers' parameter) have been modified 
   * Note that this is called from two places: 
   *   - above in checkAllowedException() for adn-ALLOWed rules
   *   - and in core::handleIncomingCookiesForAdVisits() for ad-visits
   */
  const blockIncomingCookies = exports.blockIncomingCookies = function (headers, requestUrl, originalUrl) {

    const cookieAttr = function (cookie, name) {

      const parts = cookie.split(';');
      for (let i = 0; i < parts.length; i++) {
        const keyval = parts[i].trim().split('=');
        if (keyval[0].toLowerCase() === name) { }
        return keyval[1];
      }
    }

    //console.log('[HEADERS] (Incoming' +
    //(requestUrl === originalUrl ? ')' : '-redirect)'), requestUrl);

    const originalHostname = hostnameFromURI(originalUrl);

    // allow cookies from DNT requests
    if (dntAllowsRequest(originalUrl, originalHostname)) {

      log('[DNT] (AllowCookie1p)', originalUrl);
      return false;
    }

    //console.log("1pDomain: '"+hostnameFromURI(originalUrl)+"' / '" +
    //hostnameFromURI(requestUrl)+"'", " original='"+originalUrl+"'");

    let modified = false;
    for (let i = headers.length - 1; i >= 0; i--) {

      const name = headers[i].name.toLowerCase();

      //console.log(i + ') ' + name, headers[i].value);

      if (name === 'set-cookie' || name === 'set-cookie2') {
        const cval = headers[i].value.trim();
        const domain = cookieAttr(cval, 'domain');

        if (1) { // don't block incoming cookies for 3rd party-requests coming from DNT-pages? sure
          if (domain && µb.userSettings.dntDomains.contains(domain)) {
            log('[DNT] (AllowCookie3p) \'', cval + '\' dnt-domain: ' + domain);
            continue;
          }
        }

        const requestHostname = requestUrl && hostnameFromURI(requestUrl);

        log('[COOKIE] (Block)', headers[i].value, "1pDomain: " + originalHostname +
          (requestHostname && requestHostname !== originalHostname ? ' / ' + requestHostname : ''),
          (domain ? " 3pDomain: " + domain : ''));

        headers.splice(i, 1); // remove cookie from headers
        modified = true;     // and mark them as modified (will return true)
      }
    }

    return modified;
  };

  exports.shutdown = function () {

    this.dnt.shutdown();
  };

  exports.deleteAdSet = function (request, pageStore, tabId) {
    request.ids.forEach(deleteAd);
  };


  exports.deadAd = function (request, pageStore, tabId) {
    let ad = request.ad;
    deadAd(ad, true);
  };

  exports.notDeadAd = function (request, pageStore, tabId) {
    let ad = request.ad;
    deadAd(ad, false);
  };


  exports.logAdSet = function (request, pageStore, tabId) {

    let data = '';
    request.ids.forEach(function (id) {
      data += JSON.stringify(adById(id), null, 2);
    });

    log('ADSET #' + request.gid + '\n', data);

    broadcast({
      what: 'logJSON',
      data: data
    });

    return data;
  };

  /*
   * Returns all ads for a page, or all pages, if 'pageUrl' arg is null
   * If 'currentOnly' is true, returns only current-marked ads
   *
   * Omits text-ads if specified in preferences
   * Called also from tab.js::µb.updateBadgeAsync()
   */
  const adlist = exports.adlist = function (pageUrl, currentOnly, isUI) {
    admap = admap;
    const result = [], pages = pageUrl ?
      [YaMD5.hashStr(pageUrl)] : Object.keys(admap);
    for (let i = 0; admap && i < pages.length; i++) {
      if (admap[pages[i]]) {
        const hashes = Object.keys(admap[pages[i]]);
        for (let j = 0; j < hashes.length; j++) {
          const ad = admap[pages[i]][hashes[j]];

          // ignore text-ads according to parseTextAds prefe
          if (ad && (µb.userSettings.parseTextAds || ad.contentType !== 'text')) {
            if (!currentOnly || ad.current) {
              if (isUI && ad.private) {
                const clone = Object.assign({}, ad);
                clone.hash = hashes[j];
                result.push(clone)
              } else {
                result.push(ad);
              }
            }
          }
        }
      }
    }
    return result;
  };

  /*
   * Verify if other ad blockers are already installed/enabled
   * If yes, don't enable our features(hide,click,block) until disabled
   *
   * TODO: Shall be handled differently on different browser (?)
   */
  const verifyAdBlockers = exports.verifyAdBlockers = function () {

    let modified = false;
    vAPI.getAddonInfo(function (conflict) {

      if (conflict != false) {
        modified = addNotification(notifications, AdBlockerEnabled);
      }
      else {
        modified = removeNotification(notifications, AdBlockerEnabled);
      }

      modified && sendNotifications(notifications);
    });

    return notifications.indexOf(AdBlockerEnabled) > -1 ? [AdBlockerEnabled] : [];
  };

  const verifyVersion = exports.verifyVersion = async function () {
    const version = vAPI.app.version;
    // run get request on /repos/dhowe/AdNauseam/releases
    const response = await fetch("https://api.github.com/repos/dhowe/AdNauseam/releases/latest");
    // if (!response.ok) {  // validate
    //   //throw new Error(`HTTP error! status: ${response.status}`);
    // }
    // parse response
    const latestRelease = await response.json();
    const latestVersion = latestRelease.tag_name.replace('v', '');    
    // compare versions
    if (version < latestVersion) {
      // if browser is chrome
      console.log("vAPI.webextFlavor.soup", vAPI.webextFlavor.soup)
      if (vAPI.webextFlavor.soup.has('chromium') && !vAPI.webextFlavor.soup.has('edge')) {
        // show notification
        const modified = addNotification(notifications, NewerVersionAvailable);
        modified && sendNotifications(notifications);
        // open chrome webstore
        // vAPI.tabs.open({ url: "https://chrome.google.com/webstore/detail/adnauseam/obdkhmpfckondpndnmahlekdlpiinaha" });
      }
    }
  };

  exports.verifyAdBlockersAndDNT = function (request) {

    verifyDNT(request);
    verifyAdBlockers();
    verifyFirefoxSetting();
    verifyOperaSetting(request);
  };

  const verifyOperaSetting = exports.verifyOperaSetting = function (request) {

    const isOpera = (!!window.opr && !!opr.addons)
      || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;

    if (isOpera) {

      // only check for google, bing & duckduckgo
      // other search engines seem to be fine at the moment
      const searchEngineRegex = /^.*\.bing\.com|^(.*\.)?duckduckgo\.com|^(www\.)*google\.((com\.|co\.|it\.)?([a-z]{2})|com)$/i;
      const domain = parseDomain(request.url);
      const isSearch = searchEngineRegex.test(domain);

      if (!isSearch) return;

      let thisPageStore = null;
      for (let [key, pageStore] of µb.pageStores.entries()) {
        if (pageStore.rawURL === request.url) {
          thisPageStore = pageStore;
          break;
        }
      }

      // check the url in pageStore
      // if perLoadAllowedRequestCount: 0 && contentLastModified : 0
      // adnauseam is not running on this page
      if (thisPageStore) {

        let modified = false;
        if (thisPageStore.counts.blocked.any == 0 && thisPageStore.contentLastModified == 0) {
          modified = addNotification(notifications, OperaSetting);
        } else {
          modified = removeNotification(notifications, OperaSetting);
        }
        modified && sendNotifications(notifications);
      }
    }
  }

  const verifyFirefoxSetting = exports.verifyFirefoxSetting = function () {
    const tpmFunction = browser.privacy.websites.trackingProtectionMode;

    if (typeof tpmFunction === 'undefined') return; // if not firefox
    const trackingProtectionMode = tpmFunction.get({});

    trackingProtectionMode.then((got) => {
      let modified = false;
      if (got.value == "always") {
        modified = addNotification(notifications, FirefoxSetting);
      } else {
        modified = removeNotification(notifications, FirefoxSetting);
      }
      modified && sendNotifications(notifications);
    });
  }

  const verifySettings = exports.verifySettings = function () {

    verifySetting(HidingDisabled, !µb.userSettings.hidingAds);
    verifySetting(ClickingDisabled, !µb.userSettings.clickingAds);
    verifySetting(BlockingDisabled, !µb.userSettings.blockingMalware);
    verifySetting(ShowAdsDebug, µb.hiddenSettings.showAdsDebug);
  };

  const verifyLists = exports.verifyLists = function () {

    verifyList(EasyList, µb.selectedFilterLists);
    verifyList(AdNauseamTxt, µb.selectedFilterLists);
  };

  const verifyList = exports.verifyList = function (note, lists) {

    let modified = false, entry;
    for (let i = 0; i < lists.length; i++) {

      if (lists[i] === note.listName) {
        entry = lists[i];
      } else if (note.listName === "easylist" && lists[i] === "fanboy-ultimate") {
        // EasyList && Fanboy's Ultimate Merged List
        entry = note.listName;
      }
    }

    if (entry) {
      modified = removeNotification(notifications, note);
    }
    else {
      modified = addNotification(notifications, note);
    }

    if (modified) sendNotifications(notifications);
  };

  const verifyDNT = function (request) {

    const prefs = µb.userSettings;
    const domain = domainFromHostname(hostnameFromURI(request.url));
    const target = hasDNTNotification(notifications);

    //console.log("verifyDNT: " + domain, request.url, prefs.dntDomains);

    // if the domain is not in the EFF DNT list, remove DNT notification and return
    if (!domain || !prefs.dntDomains.contains(domain)) {

      // if notifications contains any DNT notification, remove
      if (target) {

        removeNotification(notifications, target);
        sendNotifications(notifications);
      }

      return;
    }

    // continue if the domain is in EFF DNT list

    const disableClicking = (prefs.clickingAds && prefs.disableClickingForDNT);
    const disableHiding = (prefs.hidingAds && prefs.disableHidingForDNT);

    let note = DNTNotify; // neither clicking nor hiding
    if (
      (disableClicking && disableHiding) ||
      (!prefs.clickingAds && disableHiding) ||
      (!prefs.hidingAds && disableClicking)) {
      note = DNTAllowed;
    }
    else if (disableClicking && prefs.hidingAds && !prefs.disableHidingForDNT) {
      note = DNTHideNotClick;
    }
    else if (prefs.clickingAds && !prefs.disableClickingForDNT && disableHiding) {
      note = DNTClickNotHide;
    }

    if (!notifications.contains(note)) {

      addNotification(notifications, note);

      if (target && target != note) {

        removeNotification(notifications, target);
      }

      sendNotifications(notifications);
    }
  };

  const verifySetting = exports.verifySetting = function (note, state) {
    //console.log('verifySetting', note, state, notifications);

    let modified = false;

    if (state && !notifications.contains(note)) {

      modified = addNotification(notifications, note);
    }
    else if (!state) {

      modified = removeNotification(notifications, note);
    }

    if (modified) {

      // ADN/TODO: need a new way to check this (broken in merge1.13.2) ************************
      /* check whether DNT list state needs updating (TODO:)
  
      if (note === ClickingDisabled || note === HidingDisabled) {
  
        //console.log('clicking: ', state, µb.userSettings.clickingAds || µb.userSettings.clickingAds);
        const off = !(µb.userSettings.clickingAds || µb.userSettings.hidingAds);
  
        // µb.selectFilterLists({ location: dnt.effList, off: off })
      }*/

      sendNotifications(notifications);
    }
  };

  // Returns the count for current-marked ads for the url
  // or if none exists, then all ads stored for the url
  const currentCount = exports.currentCount = function (url) {

    return adlist(url, true).length || adlist(url).length;
  };

  exports.getIconState = function (state, pageDomain, isClick, isStrict) {
    const isDNT = µb.userSettings.dntDomains.contains(pageDomain);

    let iconStatus = state ? (isDNT ? 'dnt' : (isStrict ? 'strict' : 'on')) : 'off'; // ADN

    if (iconStatus !== 'off') {
      iconStatus += (isClick ? 'active' : '');
    }

    //replace state with adn's own definitation

    switch (iconStatus) {
      case 'on':
        state = 1;
        break;
      case 'onactive':
        state = 2;
        break;
      case 'dnt':
        state = 3;
        break;
      case 'dntactive':
        state = 4;
        break;
      case 'strict':
        state = 5;
        break;
      case 'strictactive':
        state = 6;
        break;
      default:
        state = 0;
    }

    return state;
  }

  const clearAds = exports.clearAds = function () {

    const pre = adCount();

    clearAdmap();
    reloadExtPage('vault.html');
    updateBadges();
    storeAdData(true);
    computeNextId();

    visitedURLs.clear(); // user visits #1214

    log('[CLEAR] ' + pre + ' ads cleared', admap);
  };

  exports.importAds = function (request) {

    // try to parse imported ads in current format
    let importedCount = 0;

    const count = adCount();
    let map = validateImport(request.data);

    // no good, try to parse in legacy-format
    if (!map) {

      map = validateLegacyImport(request.data);

      if (map) {

        // check that legacy ads were converted ok
        map = validateImport(map);
        if (map) {

          // ok, legacy ads converted and verified
          log('[IMPORT] Updating legacy ads');
        }
        else
          warn('[IMPORT] Unable to parse as legacy-ads:', request.data);
      }
    }

    // no good, try to parse as a single-ad
    if (!map) {

      if (type(request.data) === 'object' && type(request.data.contentData) === 'object') {

        if (createAdmapEntry(request.data, map = {})) {
          importedCount = 1;
          log('[IMPORT] Found single Ad', request.data, map);
        }
        else
          warn('[IMPORT] Unable to parse as single-ad:', request.data);
      }
    }

    if (!map) {

      warn('[IMPORT] Unable to parse import-format:', request.data);
      return { // give up and show 0 ads imported
        what: 'importConfirm',
        count: 0
      };
    }

    admap = map;
    computeNextId();
    if (clearVisitData) clearAdVisits();


    importedCount = adCount() - count;
    log('[IMPORT] ' + importedCount + ' ads from ' + request.file);
    reloadExtPage('vault.html'); // reload Vault page if open

    validateHashes();
    storeAdData(true);

    return {
      what: 'importConfirm',
      count: importedCount
    };
  };

  // check if "disable warning" option is enabled or not 
  exports.getWarningDisabled = function () {
    return µb.userSettings.disableWarnings;
  };
  
  
  // check if "blur collected ads" options is enabled or not 
  exports.getBlurCollectedAds = function () {
    return µb.userSettings.blurCollectedAds;
  };

  // check if "blur collected ads" options is enabled or not 
  exports.getHideDeadAds = function () {
    return µb.userSettings.hideDeadAds;
  };
  
  // ADN broadcast change of "disable warning" to all tabs
  exports.setWarningDisabled = function () {
    broadcast({
      what: µb.userSettings.disableWarnings ? 'hideNotifications' : 'showNotifications',
    });
    return µb.userSettings.disableWarnings;
  };


  exports.getNotifications = function () {
    return {
      notifications:notifications,
      disableWarnings:µb.userSettings.disableWarnings,
      blurCollectedAds: µb.userSettings.blurCollectedAds
    };
  };

  const exportAds = exports.exportAds = function (request) {

    const count = adCount(), jsonData = admapToJSON(request.sanitize);

    if (!production && request.includeImages) saveVaultImages();

    log('[EXPORT] ' + count + ' ads');

    return jsonData;
  };

  exports.closeExtPage = function (request) {

    const tabId = getExtPageTabId(request.page);
    tabId && vAPI.tabs.remove(tabId, true);
  }

  exports.adsForPage = function (request, pageStore, tabId) {

    const reqPageStore = request.tabId &&
      µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore) {
      warn('No pageStore', request, pageStore, tabId);
      return;
    } else if (!reqPageStore.hasOwnProperty('rawURL')) {
      warn('No rawURL', reqPageStore, request, tabId);
      return;
    }

    const allAds = adlist()
    const json = adsForUI(reqPageStore.rawURL);
    json.total = allAds.length;
    json.clicked = allAds.filter(ad => ad.visitedTs).length;

    // if we have no page ads, use the most recent (6)
    // avoid sending data for too many ads in messaging
    if (!json.data.length) {
      json.data = allAds.sort(byField('-foundTs')).slice(0, 6);
      json.recent = true;
    }

    return json;
  };

  exports.purgeDeadAds = function (request, pageStore, tabId) {
    purgeDeadAdsAdmap(request.deadAds);
    return adsForUI();
  };

  return exports;
})();

/****************************** messaging ********************************/

(function () { // pass all incoming messages directly to exported functions

  'use strict';

  const onMessage = function (request, sender, callback) {
    //console.log("adnauseam.MSG: "+request.what);

    switch (request.what) {
      default: break;
    } // Async

    let tabId = request.tabId || (sender && sender.tabId) || null;
    let pageStore = µb.pageStoreFromTabId(tabId);

    if (typeof adnauseam[request.what] === 'function') {

      if (request.what !== 'toggleEnabled') { // fix for https://github.com/dhowe/AdNauseam/issues/2516
        // Why do we do this?
        request.url && (request.url = trimChar(request.url, '/')); // no trailing slash
      }
      callback(adnauseam[request.what](request, pageStore, tabId));
      adnauseam.markUserAction(); // assume user-initiated and thus no longer 'idle'

    } else {

      console.warn(`[ADN] No listener for ${request.what} message`);
      return vAPI.messaging.UNHANDLED;
    }
  }

  vAPI.messaging.listen({
    name: 'adnauseam',
    listener: onMessage
  })

})();


/******************************* Polyfill ***********************************/

if (!Array.prototype.hasOwnProperty('contains')) {
  Array.prototype.contains = function (a) {
    let b = this.length;
    while (b--) {
      if (this[b] === a) {
        return true;
      }
    }
    return false;
  };
}

if (!String.prototype.hasOwnProperty('startsWith')) {
  String.prototype.startsWith = function (needle, pos) {
    if (typeof pos !== 'number') {
      pos = 0;
    }
    return this.lastIndexOf(needle, pos) === pos;
  };
}

if (!String.prototype.hasOwnProperty('endsWith')) {
  String.prototype.endsWith = function (needle, pos) {
    if (typeof pos !== 'number') {
      pos = this.length;
    }
    pos -= needle.length;
    return this.indexOf(needle, pos) === pos;
  };
}

if (!String.prototype.hasOwnProperty('includes')) {
  String.prototype.includes = function (needle, pos) {
    if (typeof pos !== 'number') {
      pos = 0;
    }
    if (start + search.length > this.length)
      return false;
    return this.indexOf(needle, pos) > -1;
  };
}

/*************************************************************************/

// Expose globally for benchmarking/automation tools (mirrors self.µBlock pattern)
self.adnauseam = adnauseam;

export default adnauseam

/*************************************************************************/
