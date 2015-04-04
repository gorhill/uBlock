# Submitting issues

### uBlock <3's you

First of all, thank you for taking the time to help improve uBlock!

---

### Issue template

Probably the easiest way to submit an issue.

**[Use this link to start with the standard issue template.](https://github.com/chrisaljoudi/uBlock/issues/new?title=[BrowserName]%20ShortDescription&body=%3C!--%0AInstructions%3A%0A%0AReplace%20the%20relevant%20parts%20of%20this%20template%20%0Awith%20details%20applicable%20to%20your%20case.%20Please%0Adon't%20remove%20the%20headers%2Fsubtitles.%0A%0ADon't%20worry%20about%20removing%20these%20instructions%3B%0Athey're%20not%20visible%20once%20you%20submit%20your%20issue.%0A%0AFor%20details%20about%20issues%2C%20check%20out%3A%0Ahttps%3A%2F%2Fgithub.com%2Fchrisaljoudi%2FuBlock%2Fblob%2Fmaster%2FCONTRIBUTING.md%23before-you-submit%0A--%3E%0A%0A%23%23%20Steps%20to%20Reproduce%0A1.%20Replace%20this%20example%20list%20with%20a%20list%20of%20steps%20to%20reproduce%20the%20issue%0A2.%20Example%20step%202%0A3.%20Feel%20free%20to%20add%20more%20steps%0A%0A%23%23%20Symptoms%0AReplace%20this%20with%20a%20description%20of%20what%20the%20symptoms%20you're%20observing%20are.%0A%0A%23%23%20Preferences%20Different%20From%20Defaults%0AWe%20recommend%20a%20screenshot%20—%20include%20any%20filter%20lists%20you%20enabled%2Fdisabled%2C%20whitelisted%20sites%2C%20etc.%0A%0A%23%23%20Info%0A%0A%60%60%60%0AuBlock%20version%3A%0A%20%20%20%200.0.0.0%0ABrowser%20and%20version%3A%0A%20%20%20%20Browser%201.2.3%0AOS%20and%20version%3A%0A%20%20%20%20OS%2010%0A%60%60%60%0A%0A%23%23%20Other%20Extensions%0A%0A*%20None.)**

---

### Before you submit

1. Please submit bugs/issues only.
1. Make sure your issue [hasn't already been fixed in a recent release](https://github.com/chrisaljoudi/uBlock/releases). That's good news!
1. Verify that the issue does **not** occur with uBlock disabled. If it still occurs with uBlock disabled, it's probably not an issue with uBlock.
 
---

### What to include


To help us diagnose and fix the problem, please always, always include the following in your report:

* A clear list of steps to reproduce the problem
  * **Always include a URL**, _even_ if "it happens everywhere".
* Symptoms of the issue
  * Describe what you observe and consider broken behavior; this is what we'll be looking for after executing the steps
  * Example: video doesn't start playing, page layout broken
* A screenshot of **any** of uBlock's preferences that differ from the defaults
  * This includes a whitelisted website, enabled/disabled filter list, anything
  * Please do include everything different from the defaults whether or not it seems relevant to your issue
* The version of uBlock you're having the issue with; you can find this in [uBlock's popup UI](https://github.com/chrisaljoudi/uBlock/wiki/Quick-guide:-popup-user-interface)
  * Example: `uBlock 0.9.0.0`
* The browser you're using and its version
  * Examples: `Firefox 36`, `Safari 8.0.5`, `Chrome 41.0.2272` 
* The OS you're using and its version
  * Examples: `OS X 10.10`, `Windows 8.1`, `Linux Mint 17.1`
* A list of other extensions you have installed
  * Tip: try disabling them and see if your issue still occurs

By following this format, you'd be greatly increasing the efficiency of resolving the issue.

Otherwise, we've noticed that a lot of ***your*** time (and the developers') gets thrown away on exchanging back and forth to get this information.
