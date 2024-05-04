<?php
/**
 * Copyright (C) Jyxon, Inc. All rights reserved.
 * See LICENSE for license details.
 */
namespace Jyxon\GdprCookieCompliance\Cookie;

class Settings
{
    /**
     * Contains the allowed cookie scopes.
     *
     * @var array
     */
    private $allowedCookies;

    /**
     * Contains the scope settings from the configuration file.
     *
     * @var array
     */
    private $scopeSettings;

    /**
     * Constructor
     *
     * @param string $settingsPath
     */
    public function __construct(string $settingsPath = '')
    {
        $settingsPath = ($settingsPath == '' ? dirname(__FILE__) . '/../Config/config.json' : $settingsPath);
        $this->setScopeSettings($settingsPath);
        $this->setAllowedCookies();
    }

    /**
     * Returns the allowed cookies.
     *
     * @return array
     */
    public function getAllowedCookies(): array
    {
        return $this->allowedCookies;
    }

    /**
     * Sets the local variable of $allowedCookies with the contents of the "gdpr_cookie" contents.
     *
     * @return void
     */
    private function setAllowedCookies()
    {
        $allowed = (isset($_COOKIE["gdpr_cookie"]) ? explode(',', $_COOKIE["gdpr_cookie"]) : []);
        foreach ($this->scopeSettings["scopes"] as $scope) {
            if ($scope['required'] == 1) {
                $allowed[] = $scope['scope'];
            }
        }

        $this->allowedCookies = $allowed;
    }

    /**
     * Fetches the settings from the config.json file.
     *
     * @param string $settingsPath
     *
     * @return void
     */
    private function setScopeSettings(string $settingsPath)
    {
        $this->scopeSettings = json_decode(file_get_contents($settingsPath), true);
    }
}
