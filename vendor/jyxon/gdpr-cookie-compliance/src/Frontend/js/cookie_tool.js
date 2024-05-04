function cookie_tool()
{
    return {
        setCookie: (function (name, value, expiration, path = "/")
        {
            var currentDate = new Date();
            currentDate.setDate(currentDate.getDate() + expiration);
            var expires = "expires=" + currentDate.toUTCString();
            document.cookie = name + "=" + value + ";" + expires + ";path=" + path + ";";
        }),
        getCookie: (function (name)
        {
            name += "=";
            var decodedCookie = decodeURIComponent(document.cookie);
            var variables = decodedCookie.split(';');
            for (var i = 0; i < variables.length; i++)
            {
                var cookie = variables[i].trim();
                if (cookie.indexOf(name) == 0)
                {
                    return cookie.substring(name.length, cookie.length);
                }
            }

            return "";
        }),
        deleteCookie: (function (name, path = "/")
        {
            document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=" + path + ";";
        })
    };
}
