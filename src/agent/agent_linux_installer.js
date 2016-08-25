"use strict";

const argv = require('minimist')(process.argv);
const Service = require('node-linux').Service;

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js'
});

srv.on('install', () => {
    srv.start();
});

srv.on('alreadyinstalled', () => {
    console.log('Noobaa local service is already installed');
    srv.start();
});

srv.on('uninstall', () => {
    srv.stop();
});

srv.on('start', () => {
    console.log('Starting Noobaa local service');
});

if (argv.uninstall) {
    console.log('Uninstalling Noobaa local service');
    srv.uninstall();
} else {
    console.log('Installing Noobaa local service');
    srv.install();
}
