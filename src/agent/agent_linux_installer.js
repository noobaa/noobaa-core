"use strict";

const Service = require('node-linux').Service;
const argv = require('minimist')(process.argv);

var srv = new Service({
    name: 'Noobaa Local Service',
    description: 'The Noobaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/var/log/noobaaServiceWrapper.log', //TODO: DIS??
    cwd: '/usr/local/noobaa'
});

srv.on('doesnotexist', () => {
    console.log('Noobaa local service was not previously installed');
});

srv.on('install', () => {
    srv.start();
    console.log('Installing Noobaa local service');
});

srv.on('alreadyinstalled', () => {
    srv.uninstall();
    console.log('Noobaa local service is already installed');
});

srv.on('uninstall', () => {
    srv.install();
    console.log('Done uninstalling. Now reinstalling.');
});

srv.on('start', () => {
    console.log('Starting Noobaa local service');
});

if (argv.uninstall) {
    // Only using uninstall event for reinstalls. else suspending it.
    srv.suspendEvent('uninstall');
    console.log('Uninstalling Noobaa local service');
    srv.uninstall();
} else {
    if (srv.isSuspended('uninstall')) {
        srv.resumeEvent('uninstall');
    }
    srv.install();
}
