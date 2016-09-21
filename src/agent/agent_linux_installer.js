"use strict";

/*
 * This script installs the agent service using node-linux. It should work
 * on very new linux os (using systemd) or very old linux os (using system v)
 */
const Service = require('node-linux').Service;
const argv = require('minimist')(process.argv);

var srv = new Service({
    name: 'NooBaa Local Service',
    description: 'The NooBaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/var/log',
    cwd: '/usr/local/noobaa'
});

srv.on('doesnotexist', () => {
    console.log('NooBaa local service was not previously installed');
    srv.suspendEvent('doesnotexist');
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
        // because we have both 'uninstall' and 'doesnotexist' events up,
        // we end up installing by calling uninstall
        srv.uninstall();
    } else {
        // this just attempts to install. if already installed, it is ignored.
        srv.install();
    }
}
