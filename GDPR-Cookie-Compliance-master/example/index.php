<?php
require_once('../vendor/autoload.php');

use Jyxon\GdprCookieCompliance\Cookie\Settings;
use Jyxon\GdprCookieCompliance\Cookie\Manager;

$settings = new Settings();
$manager = new Manager($settings);

$configuration = file_get_contents('../src/Config/config.json');

if (isset($_GET['set_cookie']) && in_array($_GET['set_cookie'], ['analytical', 'functional'])) {
    $manager->setCookie($_GET['set_cookie'], $_GET['set_cookie'] . '_cookie', 'Cookie set!', time() + 3600, '/');
}

?>
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
        <title>GDPR cookie compliance example</title>
        <link rel="stylesheet" type="text/css" href="assets/css/gdpr_cookie_bar.css">
        <style>
            a, button {
                display: inline-block;
                padding: 3px 5px;
                border: 1px solid #159615;
                background: #41b741;
                color: #fdfdfd;
                text-decoration: none;
                font-size: 14px;
                cursor: pointer;
            }

            pre {
                background-color: lightgrey; 
                border: 1px solid darkgrey; 
                padding: 5px;
                display: block;
            }
        </style>
	</head>
	<body>
        <h4>Configuration:</h4>
        <pre><?= $configuration ?></pre>
        <hr>

        <h4>Cookies set:</h4>
        <pre><?= json_encode($_COOKIE, JSON_PRETTY_PRINT) ?></pre>
        <hr>

        <h4>Analytical cookie</h4>
        <pre><?= $manager->getCookie('analytical', 'analytical_cookie') ?></pre>

        <h4>Functional cookie</h4>
        <pre><?= $manager->getCookie('functional', 'functional_cookie') ?></pre>
        <hr>
        <a href="?set_cookie=analytical">Set analytical cookie server side</a>
        <a href="?set_cookie=functional">Set functional cookie server side</a>
        <br><br>
        <script src="assets/js/cookie_tool.js"></script>
        <script src="assets/js/gdpr_compliance.js"></script>
        <script src="assets/js/gdpr_cookie.js"></script>
        <script>
            var cookieTool = cookie_tool();
            var configuration = <?= $configuration ?>;
            var gdprCompliance = gdpr_compliance(configuration, cookieTool);
            gdprCompliance.init();
            var gdprCookie = gdpr_cookie(gdprCompliance, cookieTool);
            var cookieDate = new Date();
            cookieDate.setTime(cookieDate.getTime() + (24*60*60*1000))
        </script>
        <button onclick="gdprCookie.setCookie(
            'analytical', 
            'analytical_cookie', 
            'Cookie set through the client!',
            cookieDate.toUTCString()
        )" type="button">Set analytical cookie client side</button>
        <button onclick="gdprCookie.setCookie(
            'functional', 
            'functional_cookie', 
            'Cookie set through the client!',
            cookieDate.toUTCString()
        )" type="button">Set functional cookie client side</button>
        <p><b>Please note:</b> Don't forget to refresh the page after setting cookies or expecting result.</p>
	</body>
</html>
