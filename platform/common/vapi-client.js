/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-2015 The uBlock Origin authors
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

// For non-background page

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/456
//   Skip if already injected.

// >>>>>>>> start of HUGE-IF-BLOCK
if (
    typeof vAPI === 'object' &&
    vAPI.randomToken instanceof Function === false
) {

const browser = globalThis.browser ?? globalThis.chrome;

/******************************************************************************/
/******************************************************************************/

vAPI.randomToken = function() {
    const n = Math.random();
    return String.fromCharCode(n * 25 + 97) +
        Math.floor(
            (0.25 + n * 0.75) * Number.MAX_SAFE_INTEGER
        ).toString(36).slice(-8);
};

vAPI.sessionId = vAPI.randomToken();
vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.shutdown = {
    jobs: [],
    add(job) {
        this.jobs.push(job);
    },
    exec() {
        // Shutdown asynchronously, to ensure shutdown jobs are called from
        // the top context.
        self.requestIdleCallback(( ) => {
            const jobs = this.jobs.slice();
            this.jobs.length = 0;
            while ( jobs.length !== 0 ) {
                (jobs.pop())();
            }
        });
    },
    remove(job) {
        let pos;
        while ( (pos = this.jobs.indexOf(job)) !== -1 ) {
            this.jobs.splice(pos, 1);
        }
    }
};

/******************************************************************************/

vAPI.messaging = {
    msgCounter: 0,
    waitStartTime: 0,

    shutdown() {
    },

    async send(channel, msg) {
        if ( this.msgCounter === 0 ) {
            this.waitStartTime = Date.now();
        } else if ( this.msgCounter > 64 ) {
            if ( (Date.now() - this.waitStartTime) > 60000 ) {
                return vAPI.shutdown.exec();
            }
        }
        this.msgCounter += 1;
        try {
            return browser.runtime.sendMessage({ channel, msg }).then(response => {
                this.msgCounter -= 1;
                return response;
            });
        } catch {
        }
    },
};

vAPI.shutdown.add(( ) => {
    vAPI.messaging.shutdown();
    self.vAPI = undefined;
});

/******************************************************************************/
/******************************************************************************/

}
// <<<<<<<< end of HUGE-IF-BLOCK








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;
