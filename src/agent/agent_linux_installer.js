"use strict";

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

console.log(process.pid, "is registering to events");

srv.on('doesnotexist', () => {
    var err = new Error();
    console.log('Stack trace: ', err.stack);
    console.log(process.pid, 'NooBaa local service was not previously installed');
    srv.install();
});

srv.on('install', () => {
    var err = new Error();
    console.log('Stack trace: ', err.stack);
    console.log(process.pid, 'Done installing NooBaa local service');
    srv.start();
});

srv.on('alreadyinstalled', () => {
    var err = new Error();
    console.log('Stack trace: ', err.stack);
    console.log(process.pid, 'NooBaa local service is already installed');
});

srv.on('uninstall', () => {
    var err = new Error();
    console.log('Stack trace: ', err.stack);
    // Will only get here if the script was run with --repair cli arg
    console.log(process.pid, 'Done uninstalling NooBaa local service. Now reinstalling.');
    srv.install();
});

srv.on('start', () => {
    var err = new Error();
    console.log('Stack trace: ', err.stack);
    console.log(process.pid, 'Starting NooBaa local service');
});

if (argv.uninstall) {
    // Only using uninstall event for reinstalls. else suspending it.
    if (!srv.isSuspended('uninstall')) srv.suspendEvent('uninstall');
    if (!srv.isSuspended('doesnotexist')) srv.suspendEvent('doesnotexist');
    console.log(process.pid, 'Uninstalling NooBaa local service');
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
