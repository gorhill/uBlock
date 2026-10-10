/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock

*/

// Important!
// Isolate from global scope

// Start of local scope
(function uBOL_scriptletFrameworkEnd($SECRET_ID$) {

/******************************************************************************/

const scriptletGlobals = self[$SECRET_ID$];
delete self[$SECRET_ID$];
scriptletGlobals.origins = undefined;
scriptletGlobals.functionRefs = undefined

/******************************************************************************/

// End of local scope
})(self.$scriptletSecret$);

void 0;
