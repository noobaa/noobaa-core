"use strict";

const Service = require('node-linux').Service;

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js'
});

srv.on('install', () => {
    console.log('Installing Noobaa local service');
    srv.start();
});

srv.on('alreadyinstalled', () => {
    console.log('Noobaa local service is already installed');
    srv.start();
});

srv.on('start', () => {
    console.log('Starting Noobaa local service');
});

srv.install();
