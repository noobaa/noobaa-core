#!/usr/bin/env node

'use strict';
var program = require('commander'),
    fs = require('fs'),
    S3rver = require('./s3rver');

program.option('-h, --hostname [value]', 'Set the host name or ip for the server', 'localhost')
    .option('-p, --port <n>', 'Set the port of the http server', 4568)
    .option('-s, --silent', 'Suppress log messages', false)
    .option('-d, --directory [path]', 'Data directory')
    .parse(process.argv);

if (program.directory === undefined) {
    console.error('Data directory is required');
    return;
}

try {
    var stats = fs.lstatSync(program.directory);
    if (stats.isDirectory() === false) {
        throw Error();
    }
} catch (e) {
    console.error('Directory does not exist. Please create it and then run the command again');
    return;
}

var s3rver = new S3rver();
s3rver.setHostname(program.hostname)
    .setPort(program.port)
    .setDirectory(program.directory)
    .setSilent(program.silent)
    .run(function(err, host, port) {
        console.log('S3 is listening on host %s and port %d', host, port);
    });