[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/Jyxon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# GDPR cookie compliance package
The new [GDPR Law](https://www.itgovernance.eu/blog/en/how-the-gdpr-affects-cookie-policies/) brings some changes with it to the behavior of cookies. This package provides a simple implementation that can be used to comply with these new set of rules. This law is targeting cookies that can be used to identify a visitor. This identification through cookies is now considered personal information, so it requires extra care and consent.
Visitors of your website need to have the following two abilities surrounding cookies:
- Explicitly accept cookies, meaning they have to `opt-in` to use cookies that could possible identify them.
- Have an easy `opt-out` option to retract their consent.

## Contents
To comply with this law this package adds the following abilities in an easy implementation.
- Set scopes of cookies so only tracking cookies can be turned off, or even filter cookies to specific services.
- Add a cookie-bar that only automatically expands on the first visit.
- Add a cookie settings button to the website, to edit preferences.
- Provide you with pre-written logic to easily get and set cookies, but only with consent in JavaScript and PHP.

## Installation
Add the package to your project through composer with the following command:
```
composer require jyxon/gdpr-cookie-compliance
```

## Implementation

### Configuration
There are 2 main components to the configurations.

#### scopes
The `scopes` are the different areas cookies can be set for. For example you could have functional and analytical cookies. A scope entry looks like the following:
```json
{
    "scope": "functional",
    "required": 1,
    "title": "Functional cookies",
    "description": "These are the cookies we set purely for functionalities in our websites. We can not track you in any way by settings these. For example if we didn't set a cookie that stored these settings, we wouldn't be able to not constantly prompt you with this screen."
}
```
The first parameter `scope`, is a name you will use throughout your code to identify the type of cookie. This should be a string.
The second parameter `required`, is a flag to determine if the cookie is necessary for normal operations. This should be an integer (either `1` or `0`).
The third parameter `title`, is the title of the cookie that is shown to the user in the settings. This should be a string.
The fourth parameter `description`, is the description for the cookie, which is also shown to the user.

As much scopes as necessary can be added and used through this file.

#### messages
The `messages` are a predefined set of key/value paired strings to show certain messages or titles in the pop-up/settings button. The keys should stay intact, but the values can be adjusted to your liking.
```JSON
{
    "required_help": "These cookies can not be unset during your visit to this website, because this would result in degraded performance.",
    "settings_button": "Cookie Settings",
    "cookiebar_title": "Change your cookie settings.",
    "cookiebar_button": "Accept Settings",
    "cookiebar_description": "To comply with new regulations regarding GDPR we are now obligated by law to provide you with settings surrounding cookies. We have not set any cookies that would be able to track you. If you wish to change these settings later on, we will provide you with a button in order to do so."
}
```

`required_help` = the balloon that shows when you hover over a required checkbox.
`settings_button` = the title of the button in the lower right corner (with default styles).
`cookiebar_title` = the title of the cookie bar itself.
`cookiebar_button` = the title of the save settings button.
`cookiebar_description` = the description that is shown on the cookie bar under the title.

### Frontend (JS)
This package provides three small packages for JavaScript, and some additional styling.

#### cookie_tool.js
The `cookie_tool` has three basic cookie functions. To initialize the tool load the `cookie_tool.js` file to your HTML (depending on your project, you might have to move the file to your `pub` folder).
To create an instance simply write the following code. Below is also defined which functions are exposed in this tool.

```JavaScript
var cookieTool = cookie_tool();

// Creates a cookie.
cookieTool.setCookie(name, value, expiration, path = "/");

// Retrieves the value of the cookie.
cookieTool.getCookie(name);

// Deletes the cookie.
cookieTool.deleteCookie(name, path = "/");
```

#### gdpr_compliance.js
This file contains the logic for the cookie bar. It should add a cookie bar and a settings button to your DOM (before the end on the body). For this tool to work, you also need to have contents of the config.json (or your own) file exposed to the function.

To initialize this write down the following code:
```JavaScript
var cookieTool = cookie_tool();
var configuration = /**contents of your config.json here*/;
var gdprCompliance = gdpr_compliance(configuration, cookieTool);
gdprCompliance.init();
```

#### gdpr_cookie.js
For some projects it might be required to set and get cookies through JavaScript. That is where this tool comes into play.
To initialize this tool use the following code:
```JavaScript
var cookieTool = cookie_tool();
var configuration = /**contents of your config.json here*/;
var gdprCompliance = gdpr_compliance(configuration, cookieTool);
gdprCompliance.init();
var gdprCookie = gdpr_cookie(gdprCompliance, cookieTool);
```

The `gdpr_cookie` tool exposes the `setCookie` and `getCookie` functions in almost the same way as the `cookie_tool`, except these are now wrapped in checks for consent. It also implements the `deleteCookie` function so you don't have to switch between tools all the time.

#### gdpr_cookie_bar.css
This tool is also shipped with a complimentary stylesheet, just include it in your HTML and it should at least look decent.

### Backend (PHP)
To also use the package for the backend (PHP only), use the following libraries.

#### Settings
Before setting cookies, the application should know is allowed and what not. To load the `Settings` write the following code.
```PHP
use Jyxon\GdprCookieCompliance\Cookie\Settings;

//This will default to the config.json provided with the package.
$settings = new Settings();
```

The settings file can also be changed by giving the `__construct` a path (string) as a parameter. Like so:
```PHP
$settings = new Settings('/some/path/on/my/server/config.json');
```

#### Manager
In order to set cookies, the `Manager` needs to be used. The `Manager` has a dependency on `Settings`. To initialize the `Manager` write the following code:
```PHP
use Jyxon\GdprCookieCompliance\Cookie\Settings;
use Jyxon\GdprCookieCompliance\Cookie\Manager;

$settings = new Settings();
$manager = new Manager($settings);
```

The `Manager` can then be used to replace your standard `setcookie` functions with an additional parameter: `scope`. As an example the following could be done:
```PHP
//old
setcookie('functional_cookie_name', 'some-non-tracking-value', time() + 3600, '/', '*.mydomain', 1);
setcookie('tracking_cookie_name', 'uniquely-identifiable-information', time() + 360000, '/', '*.mydomain', 1);

//new
$manager->setCookie('functional', 'functional_cookie_name', 'some-non-tracking-value', time() + 3600, '/', '*.mydomain.com', 1);
$manager->setCookie('analytical', 'tracking_cookie_name', 'uniquely-identifiable-information', time() + 360000, '/', '*.mydomain.com', 1);
```

The only variable that gets added is the first one, this is the `scope` in which the cookie "lives". The manager exposes the following functions:
```PHP
/**
 * Checks wether there is consent for setting a cookie.
 *
 * @param string $scope
 *
 * @return bool
 */
public function canSet(string $scope): bool;

/**
 * Send a cookie if there is consent. Also deletes cookies for which is no longer consent.
 *
 * @param string $scope
 * @param string $name
 * @param string $value
 * @param integer $expire
 * @param string $path
 * @param string $domain
 * @param boolean $secure
 * @param boolean $httponly
 *
 * @return bool
 */
public function setCookie(string $scope, string $name, string $value = "", int $expire = 0, string $path = "", string $domain = "", bool $secure = false, bool $httponly = false): bool;

/**
 * Fetch a cookie if there is consent. Also deletes cookies for which is no longer consent.
 *
 * @param  string  $scope
 * @param  string  $name
 * @param  string  $path
 * @param  string  $domain
 * @param  boolean $secure
 * @param  boolean $httponly
 *
 * @return mixed
 */
public function getCookie(string $scope, string $name, string $path = "", string $domain = "", bool $secure = false, bool $httponly = false);
```

## Feedback
We like to get some feedback on this package. You can do so by creating an issue on GitHub.

## Donate
If this package helped you out, please consider [donating](https://paypal.me/Jyxon).

## MIT License
Copyright 2018 Jyxon

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
