"use strict";

/*
 * This script installs the agent service using node-linux. It should work
 * on very new linux os (using systemd) or very old linux os (using system v)
 */
const Service = require('node-linux').Service;
const argv = require('minimist')(process.argv);


var fs = require('fs');


var srv = new Service({
    name: 'noobaalocalservice',
    description: 'The NooBaa node service.',
    script: '/usr/local/noobaa/src/agent/agent_wrap.js',
    wait: 10,
    logpath: '/var/log',
    cwd: '/usr/local/noobaa'
});

srv.on('doesnotexist', () => {
    console.log('NooBaa service is not yet installed');
    logg('NooBaa service is not yet installed');
});

srv.on('install', () => {
    console.log('Done installing NooBaa local service');
    logg('Done installing NooBaa local service');
    srv.start();
});

srv.on('alreadyinstalled', () => {
    console.log('NooBaa local service is already installed');
    logg('NooBaa local service is already installed');
});

srv.on('uninstall', () => {
    console.log('Done uninstalling NooBaa local service.');
    logg('Done uninstalling NooBaa local service.');
});

srv.on('start', () => {
    console.log('Starting NooBaa local service');
    logg('Starting NooBaa local service');
});

if (argv.uninstall) {
    console.log('Attempting to uninstall NooBaa local service');
    srv.uninstall();
} else {
    console.log('Installing NooBaa local service');
    srv.install();
}

function logg(str) {
    console.log(str);
    fs.appendFileSync('/tmp/testLog.txt', Date.now() + ":" + str + '\n');
}
