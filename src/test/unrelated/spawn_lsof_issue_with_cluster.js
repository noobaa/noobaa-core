/* Copyright (C) 2016 NooBaa */
'use strict';

var fs = require('fs');
var net = require('net');
var cluster = require('cluster');
var child_process = require('child_process');

var fname = '/tmp/spawn_lsof';

if (cluster.isMaster) {
    fs.unlinkSync(fname);

    show_spawn_fds('MASTER BEFORE FORK');
    cluster.fork();

    var server = net.createServer();
    server.listen(function() {
        console.log('LISTENING ON PORT', server.address().port);
    });

    show_spawn_fds('MASTER AFTER FORK');

} else {
    show_spawn_fds('WORKER');
    setInterval(function() { /* Empty Func */ }, 10000);
}

function show_spawn_fds(who) {
    console.log(who);
    var stdout = fs.openSync(fname, 'a');
    var ret = child_process.spawn('bash', ['-c', 'echo "' + who + '"; lsof -p $$ | grep TCP'], {
        detached: true,
        stdio: ['ignore', stdout, stdout],
        cwd: '/tmp'
    });
    //console.log(ret.stdout.toString());
    return ret;
}
