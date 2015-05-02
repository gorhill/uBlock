# Submitting issues

**Must read:** [How to Report Bugs Effectively](http://www.chiark.greenend.org.uk/~sgtatham/bugs.html).

### Before you submit

1. Submit **bugs/issues only**.
    - Bugs occur, I will fix them.
1. Do **NOT**:
    - Submit design ideas.
    - Submit feature requests.
    - Submit "revolutionary ideas".
    - Post comments like "+1" or "me too!" without providing new relevant info on the issue.
    - Use issues as replacement for threads on a bulletin board. [You can use Reddit](https://www.reddit.com/r/ublock+ublockorigin) for general discussion among users.
    - Any such issue will be closed without comment.
1. Make sure your issue [hasn't already been fixed in a recent release](https://github.com/gorhill/uBlock/releases).
1. Verify that the issue does **not** occur with uBlock disabled.
    - If it still occurs with uBlock disabled, it's probably not an issue with uBlock.
1. Verify that the issue is not related to a 3rd-party filter lists.
    - If it is the case, report to the list maintainer(s).
    - It helps to also test with Adblock Plus, with **same** filter lists.
        - If issue also occurs with ABP, it's most likely a filter list issue.
1. Verify that the issue is not caused by another extension, such as HTTPS Everywhere.
1. Verify that the issue is not caused by browser settings.
    - It helps to run your browser with an alternative profile to test for issues caused by user configuration, if supported.
1. Any issue opened with no effort to provide the required details will be closed without comment.

---

### What to include


To help diagnose and fix the bug/issue, please always, **always**, **ALWAYS** include the following in your report:

* A clear list of steps to reproduce the problem
  * **Always include a URL**, _even_ if "it happens everywhere". Just do it.
* Symptoms of the issue
  * Describe what you observe and consider broken behavior; this is what we'll be looking for after executing the steps
  * Example: video doesn't start playing, page layout broken
* A screenshot or transcription of **any of uBlock's preferences that differ from the defaults**
  * This includes a whitelisted website, enabled/disabled filter list, anything
  * Please do include everything different from the defaults whether or not it seems relevant to your issue
* The version of uBlock you're having the issue with; you can find this in [uBlock's popup UI](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface)
  * Example: `uBlock 0.9.0.0`
* The browser you're using and its version
  * Examples: `Firefox 36`, `Chrome 41.0.2272` 
* The OS you're using and its version
  * Examples: `Windows 8.1`, `Linux Mint 17.1`
* A list of other extensions you have installed
  * Tip: try disabling them and see if your issue still occurs

Otherwise, we've noticed that a lot of **your** time (and the developers') gets thrown away on exchanging back and forth to get this information.
