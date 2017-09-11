# Submitting issues

From now on, I will be quite less inclined to deal with issues for which little to no investigation to find the **actual cause** of a purported issue was made by the reporter. Positive contributions are those which are reported with efforts to find the actual cause of an issue, or at the very least efforts were made to narrow it as much as possible. This project is a hobby, do not expect "customer support"-style interaction. Requiring people to investigate as much as possible before opening an issue will more than likely avoid burdening the project with issues unrelated to uBO.

For **support/discussions/help**, there is [/r/uBlockOrigin](https://www.reddit.com/r/uBlockOrigin/) on Reddit -- this is where I see the most activity for people helping each other regarding uBlock Origin.

For **filter-related issues**, report on the respective filter list support site, or at [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets/issues). Use [the logger](https://github.com/gorhill/uBlock/wiki/The-logger) to diagnose/confirm filter-related issues. If something does not work properly with uBO enabled, the **first step** is to rule out filter-related issues.

Ignorance of the above rules is no excuse: **Opening an issue for purpose of support or discussion, or opening a filter-related issue will result in the user being immediately blocked.** Given the [amount of invalid issues being opened](https://github.com/gorhill/uBlock/issues?q=is%3Aissue+label%3Ainvalid+is%3Aclosed), I have no choice but to resort to such a drastic measure. You will still be able to open filter list issues at [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets/issues).

**The issue tracker is for provable issues only:** You will have to make the case that the issue is really with uBlock Origin and not something else on your side. To make a case means to provide detailed steps so that anybody can reproduce the issue. Be sure to rule out that the issue is not caused by something specific on your side. Specifically, _speculated_ performance issues will be marked as invalid and closed if they do not come with **actual profiling data + analysis** supporting the claim.

**Any issue opened without effort to provide the required details for me (or anybody else) to reproduce the problem will be closed as _invalid_.** If you provide more details thereafter for me to reproduce the issue, I will reopen it if I can confirm there is indeed an issue with uBlock Origin. Example of detailed steps:

> 1. browser version/ublock version
> 1. these settings, these filter lists, these custom filters.
> 1. do this.
> 1. open this exact URL.
> 1. do this.
> 1. observe this.
> 1. click this.
> 1. observe such and such issue
> 1. see screenshot
> 1. etc.

The most important part when opening an issue: **detailed steps**.

**Important:** I simply do not have the time to take care of filter-related issues, you will have to find help elsewhere for this. The mere need to have to respond to filter-related issues can quickly become a burden. Consider that writing code/doc occupies all my free time. Surely there are other people out there ready to help with filter-related issues, it does not have to be me.

***

### Before you submit

1. Submit **bugs/issues only**.
    - Bugs occur, I will fix them.
1. _One specific_ issue per submission.
1. The logger is the tool of choice to use to help diagnose issues.
1. Do **NOT**:
    - Submit pull requests.
    - Submit design ideas.
    - Submit feature requests.
    - Submit "revolutionary ideas".
    - Post comments like "+1" or "me too!" without providing new relevant info on the issue.
    - Use issues as replacement for threads on a bulletin board.
    - Any such issue will be closed without comment.
    - Ask me to publish the latest version to AMO/Chrome store: In all likelihood it is already published, but pending review, something which is out of my control.
1. Make sure your issue [hasn't already been fixed in a recent release](https://github.com/gorhill/uBlock/releases).
1. Verify that the issue does **not** occur with uBlock disabled.
1. **Verify that the issue is not related to a 3rd-party filter lists.**
    - Issues with 3rd-party filter lists are the responsibility of their respective maintainers.
1. Verify that the issue is not caused by another extension.
1. Do not submit issues which can be reproduced **only** on Chrome Canary or Firefox Nightly: these are not stable browser versions and in all likelihood, whatever issue is not within uBO.
    - Report **only** if you can reproduce in an official stable release, or a beta release.

***

### What to include

To help diagnose and fix the bug/issue, please always include the following in your report:

* A clear list of steps to reproduce the problem
  * **ALWAYS INCLUDE A SPECIFIC URL WHERE THE ISSUE OCCURS**, _even_ if "it happens everywhere".
* Symptoms of the issue
  * Describe what you observe and consider broken behavior; this is what we'll be looking for after executing the steps
  * Example: video doesn't start playing, page layout broken
* Include whatever relevant the logger reports.
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

***

**Good read:** [How to Report Bugs Effectively](http://www.chiark.greenend.org.uk/~sgtatham/bugs.html).
