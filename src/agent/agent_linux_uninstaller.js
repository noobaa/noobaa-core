"use strict";

const Service = require('node-linux').Service;

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js'
});

srv.on('uninstall', () => {
    console.log('Noobaa local service has been uninstalled');
});

srv.on('stop', () => {
    srv.uninstall();
});

srv.uninstall();
