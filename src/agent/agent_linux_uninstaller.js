"use strict";

const Service = require('node-linux').Service;

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/var/log/noobaaServiceWrapper.log' //TODO: DIS??
});

srv.on('uninstall', () => {
    console.log('Noobaa local service has been uninstalled');
});

srv.on('doesnotexist', () => {
    console.log('Noobaa local service was not previously installed');
});

srv.uninstall();
