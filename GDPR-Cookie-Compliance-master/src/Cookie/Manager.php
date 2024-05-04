<?php
/**
 * Copyright (C) Jyxon, Inc. All rights reserved.
 * See LICENSE for license details.
 */
namespace Jyxon\GdprCookieCompliance\Cookie;

class Manager
{
    /**
     * Contains the Settings object.
     *
     * @var Settings
     */
    private $settings;

    /**
     * Constructor
     *
     * @param Settings $settings
     */
    public function __construct(Settings $settings)
    {
        $this->settings = $settings;
    }

    /**
     * Checks wether there is consent for setting a cookie.
     *
     * @param string $scope
     *
     * @return bool
     */
    public function canSet(string $scope): bool
    {
        return in_array($scope, $this->settings->getAllowedCookies());
    }

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
    public function setCookie(
        string $scope,
        string $name,
        string $value = "",
        int $expire = 0,
        string $path = "",
        string $domain = "",
        bool $secure = false,
        bool $httponly = false
    ): bool {
        if ($this->canSet($scope)) {
            return setcookie($name, $value, $expire, $path, $domain, $secure, $httponly);
        }

        if (isset($_COOKIE[$name])) {
            return setcookie($name, "", time() - 360, $path, $domain, $secure, $httponly);
        }

        return false;
    }

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
    public function getCookie(
        string $scope,
        string $name,
        string $path = "",
        string $domain = "",
        bool $secure = false,
        bool $httponly = false
    ) {
        if (isset($_COOKIE[$name])) {
            if ($this->canSet($scope)) {
                return $_COOKIE[$name];
            }

            setcookie($name, "", time() - 360, $path, $domain, $secure, $httponly);
        }

        return null;
    }
}
