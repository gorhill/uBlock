µBlock.adnauseam.dnt = (function () {

  'use strict';

  const µb = µBlock, adn = µb.adnauseam, log = adn.log;
  //const effList = 'eff-dnt-whitelist';

  let exports = {};

  const firewall = exports.firewall = new µb.Firewall();

  exports.shutdown = function () {

    this.firewall.reset();
  }

  exports.mustNotVisit = function (ad) {

    // Here we check whether either page or target are in DNT (?)
    const val = µb.userSettings.disableClickingForDNT && (
      µb.userSettings.dntDomains.indexOf(ad.pageDomain) > -1 ||
      µb.userSettings.dntDomains.indexOf(ad.targetDomain) > -1 ||
      µb.userSettings.dntDomains.indexOf(ad.targetHostname) > -1 );

    //console.log('mustBlock: ',val,µb.userSettings.disableClickingForDNT,
      //ad.targetDomain,µb.userSettings.dntDomains.indexOf(ad.targetDomain), ad);

    return val;
  }

  exports.processEntries = function (content) {
    const domains = [];

    while (content.indexOf("@@||") != -1) {

      const start = content.indexOf("@@||"), end = content.indexOf("^$", start), domain = content.substring(start + 4, end);

      domains.push(domain);
      content = content.substring(end);
    }

    log('[DNT] Parsed ' + domains.length + ' domains'); //, dntDomains);

    const current = µb.userSettings.dntDomains;
    let needsUpdate = current.length != domains.length;

    if (!needsUpdate) {

      current.sort();
      domains.sort();
      for (let i = 0; i < domains.length; ++i) {
        if (domains[i] !== current[i]) {
          needsUpdate = true;
          break;
        }
      }
    }

    if (needsUpdate) { // data has changed

      log("[DNT] Updated domains: ", domains);
      firewall.reset(); // clear old data first

      µb.userSettings.dntDomains = domains; // store domain data
      vAPI.storage.set(µb.userSettings);

      updateFilters();
    }
    else {
      log("[DNT] No new domains, ignoring...");
    }
  }

  exports.isDoNotTrackUrl = function (url) {

    return url.endsWith('effdntlist.txt');
  }

  exports.isDoNotTrackRule = function (rule) {
    const dntDomains = µb.userSettings.dntDomains;
    for (let i = 0; i < dntDomains.length; i++) {
      if (rule.indexOf(dntDomains[i]) != -1)
        return true;
    }
    return false;
  }

  exports.enabled = function () {

    const prefs = µb.userSettings;
    return (prefs.hidingAds && prefs.disableHidingForDNT)
      || (prefs.clickingAds && prefs.disableClickingForDNT);
  };

  /*const disableCosmeticFiltersFor = function (hostname, state) { // not used ?

    µb.toggleHostnameSwitch({

      name: "no-cosmetic-filtering",
      hostname: hostname,
      state: state
    });
  };*/

  const updateFilters = exports.updateFilters = function () {

    const ruleCount = Object.keys(firewall.rules).length;
    const enabled = µb.adnauseam.dnt.enabled();
    const dnts = µb.userSettings.dntDomains;

    // Only clear and possibly update if we actually find a change
    if ((enabled && ruleCount > 0) || (!enabled && ruleCount < 1)  ) {
      //log("[DNT] Ignoring update, enabled = "+enabled+" "+dnts.length);
      return;
    }

    if (enabled) { // no current-rules

      const firewallRules = []; // dynamic filters
      for (let i = 0; i < dnts.length; i++) {
        firewallRules.push("* " + dnts[i] + " * allow");
      }

      firewall.fromString(firewallRules.join('\n'), false);
      log('[DNT] Firewall enabled with ' + firewall.rules.size + ' rules');

    } else {

      firewall.reset();
      log("[DNT] Clearing all rules");
    }
  };

  exports.mustAllow = function (context) {

    let requestHostname, requestDomain, result = '';

    firewall.evaluateCellZY(context.getTabHostname(), context.getHostname(), context.type);

    if (firewall.mustBlockOrAllow()) {

      result = firewall.r;

      requestHostname = context.hostname || µb.URI.hostnameFromURI(context.url);
      requestDomain = µb.URI.domainFromHostname(requestHostname);

      if (context.tabHostname !== requestDomain) {

        µb.adnauseam.logNetEvent('[DNT*3P] (Allow) ', [ context.tabHostname + ' => ' +
          requestDomain + ' ' + context.url ]); // suspicious: may want to check
      }

      if (context.type === 'inline-script') { // #1271

        µb.adnauseam.logNetEvent('[DNT] (Allow)', [ context.tabHostname + ' => ' +
          context.hostname + ' ' + context.url  ]);
      }
    }

    return result;
  };

  return exports;

})();
