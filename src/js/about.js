
  'use strict';

(async ( ) => {

    vAPI.messaging.send('dashboard', { what: 'getAppData' }, appData => {
        uDom('#aboutNameVer').text(appData.name + ' v' + appData.version);
    });

    // document.querySelector(
    //     '[href="logger-ui.html"]'
    // ).addEventListener(
    //     'click',
    //     self.uBlockDashboard.openOrSelectPage
    // );

    const appData = await vAPI.messaging.send('dashboard', {
        what: 'getAppData',
    });

    uDom('#aboutNameVer').text(appData.name + ' v' + appData.version);

    if ( appData.canBenchmark !== true ) { return; }

    document.getElementById('dev').classList.add('enabled');

    document.getElementById('sfneBenchmark').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'sfneBenchmark',
        }).then(result => {
            document.getElementById('sfneBenchmarkResult').textContent = result;
            button.removeAttribute('disabled');
        });
    });

    uDom('#aboutNameVer').text(appData.name + ' v' + appData.version);

    if ( appData.canBenchmark !== true ) { return; }

    document.getElementById('dev').classList.add('enabled');

    document.getElementById('sfneBenchmark').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'sfneBenchmark',
        }).then(result => {
            document.getElementById('sfneBenchmarkResult').prepend(
                document.createTextNode(result.trim() + '\n')
            );
            button.removeAttribute('disabled');
        });
    });
})();
