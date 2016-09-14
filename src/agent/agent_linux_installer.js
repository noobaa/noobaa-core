"use strict";

const Service = require('node-linux').Service;

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/var/log/noobaaServiceWrapper.log', //TODO: DIS??
    cwd: '/usr/local/noobaa/'
});

srv.on('install', () => {
    srv.start();
    console.log('Installing Noobaa local service');
});

srv.on('alreadyinstalled', () => {
    srv.start();
    console.log('Noobaa local service is already installed');
});

srv.on('start', () => {
    console.log('Starting Noobaa local service');
});

srv.install();
