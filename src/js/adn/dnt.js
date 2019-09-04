µBlock.adnauseam.dnt = (function () {

  'use strict';

  var µb = µBlock, adn = µb.adnauseam, log = adn.log;
  var effList = 'eff-dnt-whitelist';

  var exports = {};

  var firewall = exports.firewall = new µb.Firewall();

  exports.shutdown = function () {

    this.firewall.reset();
  }

  exports.mustNotVisit = function (ad) {

    // Here we check whether either page or target are in DNT (?)
    var val = µb.userSettings.disableClickingForDNT && (
      µb.userSettings.dntDomains.indexOf(ad.pageDomain) > -1 ||
      µb.userSettings.dntDomains.indexOf(ad.targetDomain) > -1 ||
      µb.userSettings.dntDomains.indexOf(ad.targetHostname) > -1 );

    //console.log('mustBlock: ',val,µb.userSettings.disableClickingForDNT,
      //ad.targetDomain,µb.userSettings.dntDomains.indexOf(ad.targetDomain), ad);

    return val;
  }

  exports.processEntries = function (content) {

    var domains = [];

    while (content.indexOf("@@||") != -1) {

      var start = content.indexOf("@@||"),
        end = content.indexOf("^$", start),
        domain = content.substring(start + 4, end);

      domains.push(domain);
      content = content.substring(end);
    }

    log('[DNT] Parsed ' + domains.length + ' domains'); //, dntDomains);

    var current = µb.userSettings.dntDomains,
      needsUpdate = current.length != domains.length;

    if (!needsUpdate) {

      current.sort();
      domains.sort();
      for (var i = 0; i < domains.length; ++i) {
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
    else
      log("[DNT] No new domains, ignoring...");
  }

  exports.isDoNotTrackUrl = function (url) {

    return url.endsWith('effdntlist.txt');
  }

  exports.isDoNotTrackRule = function (rule) {
    var dntDomains = µb.userSettings.dntDomains;
    for (var i = 0; i < dntDomains.length; i++) {
      if (rule.indexOf(dntDomains[i]) != -1)
        return true;
    }
    return false;
  }

  var enabled = exports.enabled = function () {

    var prefs = µb.userSettings;
    return (prefs.hidingAds && prefs.disableHidingForDNT)
      || (prefs.clickingAds && prefs.disableClickingForDNT);
  }

  var disableCosmeticFiltersFor = function (hostname, state) { // not used ?

    µb.toggleHostnameSwitch({

      name: "no-cosmetic-filtering",
      hostname: hostname,
      state: state
    });
  }

  var updateFilters = exports.updateFilters = function () {

    var ruleCount = Object.keys(firewall.rules).length,
      enabled = µb.adnauseam.dnt.enabled(),
      dnts = µb.userSettings.dntDomains;

    // Only clear and possibly update if we actually find a change
    if ((enabled && ruleCount > 0) || (!enabled && ruleCount < 1)  ) {

      //log("[DNT] Ignoring update, enabled = "+enabled+" "+dnts.length);
      return;
    }

    if (enabled) { // no current-rules

      var firewallRules = []; // dynamic filters
      for (var i = 0; i < dnts.length; i++) {

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

    var action, requestHostname, requestDomain, result = '';

    firewall.evaluateCellZY(context.rootHostname, context.requestHostname, context.requestType);

    if (firewall.mustBlockOrAllow()) {

      result = firewall.r;

      requestHostname = context.requestHostname || µb.URI.hostnameFromURI(context.requestURL);
      requestDomain = µb.URI.domainFromHostname(requestHostname);

      if (context.rootHostname !== requestDomain) {

        µb.adnauseam.logNetEvent('[DNT*3P] (Allow) ', [ context.rootHostname + ' => ' +
          requestDomain + ' ' + context.requestURL ]); // suspicious: may want to check
      }

      if (context.requestType === 'inline-script') { // #1271

        µb.adnauseam.logNetEvent('[DNT] (Allow)', [ context.rootHostname + ' => ' +
          context.requestHostname + ' ' + context.requestURL  ]);
      }
    }

    return result;
  };

  return exports;

})();
