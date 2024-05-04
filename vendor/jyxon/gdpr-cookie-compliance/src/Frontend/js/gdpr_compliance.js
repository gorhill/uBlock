function gdpr_compliance(cookie_settings, cookie_tool)
{
    var cookieTool = cookie_tool;
    return {
        cookieSettings: cookie_settings,
        cookieTool: cookie_tool,
        cookieBarButton: '',
        cookieSettingsButton: '',
        cookieBarClose: '',
        init: (function ()
        {
            this.addElements();
            this.cookieBarButton = document.body.querySelector(".gdpr_cookie_bar_accept");
            this.cookieSettingsButton = document.body.querySelector(".gdpr_cookie_settings_button");
            this.cookieBarClose = document.body.querySelector(".gdpr_cookie_bar_close");

            this.cookieBarButton.onclick = this.setAllowed;
            this.cookieBarClose.onclick = this.hideBar;
            this.cookieSettingsButton.onclick = this.toggleBar;

            if (!this.getShown())
            {
                this.showBar();
                this.cookieTool.setCookie('gdpr_bar_shown', '1', 365);
            }
        }),
        addElements: (function ()
        {
            var scopes = this.cookieSettings.scopes;
            var allowed = this.getAllowed();
            var cookieBar = '<div class="gdpr_cookie_bar hidden">' +
                '<div class="gdpr_cookie_bar_close"></div>' +
                '<p class="gdpr_cookie_bar_title">' + this.cookieSettings.messages.cookiebar_title + '</p>' +
                '<p class="gdpr_cookie_bar_description">' + this.cookieSettings.messages.cookiebar_description + '</p>' +
                '<form class="gdpr_cookie_bar_options">';
            for (var i = 0; i < scopes.length; i++)
            {
                cookieBar += '<div class="gdpr_cookie_bar_option">' +
                    '<label for="gdpr_cookie_bar_option_' + scopes[i].scope + '">' +
                    '<div class="gdpr_cookie_bar_option_checkbox">' +
                    '<input id="gdpr_cookie_bar_option_' + scopes[i].scope + '" type="checkbox" ' +
                    (scopes[i].required == 1 ? 'disabled data-help="' + this.cookieSettings.messages.required_help + '" ' : 'name="' + scopes[i].scope + '" ') +
                    (allowed.indexOf(scopes[i].scope) > -1 ? 'checked ' : '') +
                    '>' +
                    '</div>' +
                    '<span class="gdpr_cookie_bar_option_title">' + scopes[i].title + '</span>' +
                    '<span class="gdpr_cookie_bar_option_description">' + scopes[i].description + '</span>' +
                    '</label>' +
                    '</div>';
            }

            cookieBar += '</form>' +
                '<button type="button" class="gdpr_cookie_bar_accept">' + this.cookieSettings.messages.cookiebar_button + '</button>' +
                '</div>';
            document.body.insertAdjacentHTML(
                'beforeend',
                cookieBar + '<button type="button" class="gdpr_cookie_settings_button">' + this.cookieSettings.messages.settings_button + '</button>'
            );
        }),
        showBar: (function ()
        {
            document.body.querySelector(".gdpr_cookie_bar")
                .classList.remove("hidden");
        }),
        toggleBar: (function ()
        {
            document.body.querySelector(".gdpr_cookie_bar")
                .classList.toggle("hidden");
        }),
        hideBar: (function ()
        {
            document.body.querySelector(".gdpr_cookie_bar")
                .classList.add("hidden");
        }),
        setAllowed: (function ()
        {
            var formElements = document.body.querySelector("form.gdpr_cookie_bar_options")
                .elements;
            var allowed = [];
            for (var i = 0; i < formElements.length; i++)
            {
                var elementName = formElements[i].getAttribute("name");
                if (elementName && formElements[i].checked)
                {
                    allowed.push(elementName);
                }
            }

            cookieTool.setCookie('gdpr_cookie', allowed.join(","), 365);
            document.body.querySelector(".gdpr_cookie_bar")
                .classList.add("hidden");
        }),
        getAllowed: (function ()
        {
            var scopeSettings = this.cookieSettings.scopes;
            var allowed = cookieTool.getCookie('gdpr_cookie')
                .split(",");
            for (var i = 0; i < scopeSettings.length; i++)
            {
                if (scopeSettings[i].required == 1)
                {
                    allowed.push(scopeSettings[i].scope);
                }
            }

            return allowed;
        }),
        getShown: (function ()
        {
            return (cookieTool.getCookie('gdpr_bar_shown') != "" ? true : false);
        })
    };
}
