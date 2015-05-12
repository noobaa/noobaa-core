'use strict';

var _ = require('lodash');
var stun = require('./stun');
var libnice = require('node-libnice');
var readline = require('readline').createInterface(process.stdin, process.stdout);

var agent = new libnice.NiceAgent();

agent.setStunServer(
    stun.STUN.DEFAULT_SERVER.hostname,
    stun.STUN.DEFAULT_SERVER.port);

var stream = agent.createStream(1); // 1 is number of components to init

stream.on('gatheringDone', function(candidates) {
    console.log('\n');
    console.log('My info:');
    console.log('\n');
    console.log(JSON.stringify({
        credentials: stream.getLocalCredentials(),
        candidates: candidates
    }));
    console.log('\n');
    readline.question('Exchange info:\n\n> ', function(line) {
        var info = JSON.parse(line);
        stream.setRemoteCredentials(
            info.credentials.ufrag,
            info.credentials.pwd);
        _.each(info.candidates, function(candidate) {
            stream.addRemoteIceCandidate(candidate);
        });
    });
});

stream.on('stateChanged', function(component, state) {
    console.log('stateChanged', component, state);
    // 1) state === 'connecting'
    // 2) state === 'connected'
    // 3) state === 'ready'

    if (state === 'ready') {
        setInterval(function() {
            stream.send(1, new Buffer('nice ' + new Date()));
        }, 3000);
    }
});

stream.on('receive', function(component, data) {
    console.log('receive', component, data.toString());
    // data packets
    // use stream.send(component, buffer) to transfer packets
});

stream.gatherCandidates();
