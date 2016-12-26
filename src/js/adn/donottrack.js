
µBlock.adnauseam.dnt = (function () {

  'use strict';

  var effList = 'https://www.eff.org/files/effdntlist.txt', µb = µBlock,

  var clearFiltersDNT = function () {

    var dnts = µb.userSettings.dntDomains;

    if (dnts && dnts.length) {

      // clear the net-filtering switches
      for (var i = 0; i < dnts.length; i++)
        µb.toggleNetFilteringSwitch("http://" + dnts[i], "site", true);
    }

    // clear the dynamic filter rules
    dntDynamicFilters = [];

    // reset the dntFirewall
    dntFirewall.reset();
  }

  // NEXT: Finish DNT parsing on load
  // -- Consider when clearing needs to happen
  // -- Call toggleDntFilters when µb.userSettings.disableHidingForDNT is changed
  // -- Add check for any ad clicks (when µb.userSettings.disableClickingForDNT is enabled)
  // -- Re-parse DNT list whenever it is updated

  exports.processEntriesDNT = function (content) {

    // this function get the 'original DNT list' installed with the addon
    //µb.assets.get("assets/thirdparties/www.eff.org/files/effdntlist.txt", function (d) {
    var domains = [];

    while (content.indexOf("@@||") != -1) {

      var start = content.indexOf("@@||"),
        end = content.indexOf("^$", start),
        domain = content.substring(start + 4, end);

      domains.push(domain);
      content = content.substring(end);
    }

    //log('[DNT] Parsed ' + domains.length + ' domains'); //, dntDomains);

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

      console.log("[DNT] Updated domains: ", domains);
      clearFiltersDNT(); // clear old data first before resetting

      µb.userSettings.dntDomains = domains; // store domain data
      vAPI.storage.set(µb.userSettings);

      updateFiltersDNT();
    }
    else
      console.log("[DNT] No new domains, ignoring...");
  }

  exports.isDoNotTrackUrl = function (url) {

    return (url === dntListUrl);
  }

  var dntEnabled = function () {

    return µb.userSettings.disableHidingForDNT || µb.userSettings.disableClickingForDNT;
  }

  var updateFiltersDNT = exports.updateFiltersDNT = function () {

    console.log(dntFirewall);

    clearFiltersDNT(); // clear first whenever we toggle

    var dnts = µb.userSettings.dntDomains;

    if (dnts.length && dntEnabled()) {

      console.log("[DNT] Enabling "+dnts.length+" net filters");

      for (var i = 0; i < dnts.length; i++) {

        dntDynamicFilters.push("* " + dnts[i] + " * allow");
        µb.toggleNetFilteringSwitch("http://" + dnts[i], "site", false);
      }

      // TODO: use reset ? if dntFirewall exists?
      dntFirewall.fromString(dntDynamicFilters.join('\n'), false);

      log('[DNT] Loaded firewall with ' + dnts.length + ' dynamic rules');
    }
    else {

      console.log("[DNT] Disabling DNT...");
    }
  };

});
