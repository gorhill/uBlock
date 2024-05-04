function gdpr_cookie(compliance_tool, cookie_tool)
{
    var complianceTool = compliance_tool;
    var cookieTool = cookie_tool;
    return {
        setCookie: (function (scope, name, value, expiration, path = "/")
        {
            if (complianceTool.getAllowed()
                .indexOf(scope) > -1)
            {
                cookieTool.setCookie(name, value, expiration, path);
            }
        }),
        getCookie: (function (scope, name)
        {
            var cookie = cookieTool.getCookie(name);
            if (cookie != "")
            {
                if (complianceTool.getAllowed()
                    .indexOf(scope) > -1)
                {
                    return varFull.substring(searchName.length, varFull.length);
                }

                cookieTool.deleteCookie(name);
            }
        }),
        deleteCookie: (function (name)
        {
            cookieTool.deleteCookie(name);
        })
    };
}
