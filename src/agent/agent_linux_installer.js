"use strict";

const Service = require('node-linux').Service;
const argv = require('minimist')(process.argv);

var srv = new Service({
    name: 'NooBaa Local Service',
    description: 'The NooBaa node service.',
    script: '/usr/local/NooBaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/usr/local/NooBaa/logs',
    cwd: '/usr/local/NooBaa'
});

srv.on('doesnotexist', () => {
    console.log('NooBaa local service was not previously installed');
    srv.install();
});

srv.on('install', () => {
    console.log('Done installing NooBaa local service');
    srv.start();
});

srv.on('alreadyinstalled', () => {
    console.log('NooBaa local service is already installed');
});

srv.on('uninstall', () => {
    // Will only get here if the script was run with --repair cli arg
    console.log('Done uninstalling NooBaa local service. Now reinstalling.');
    srv.install();
});

srv.on('start', () => {
    console.log('Starting NooBaa local service');
});

if (argv.uninstall) {
    // Only using uninstall event for reinstalls. else suspending it.
    if (!srv.isSuspended('uninstall')) srv.suspendEvent('uninstall');
    if (!srv.isSuspended('doesnotexist')) srv.suspendEvent('doesnotexist');
    console.log('Uninstalling NooBaa local service');
    srv.uninstall();
} else {
    if (srv.isSuspended('uninstall')) srv.resumeEvent('uninstall');
    if (argv.repair) {
        if (srv.isSuspended('doesnotexist')) srv.resumeEvent('doesnotexist');
        srv.uninstall();
    } else {
        srv.install();
    }
}
