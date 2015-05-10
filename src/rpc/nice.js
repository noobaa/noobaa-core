'use strict';

var libnice = require('node-libnice');

module.exports = connect;

function connect() {
    var agent = new libnice.NiceAgent();

    // agent.setStunServer(stun.STUN.PUBLIC_SERVERS[0].hostname, stun.STUN.PUBLIC_SERVERS[0].port);

    var stream = agent.createStream(1); // 1 is number of components to init

    stream.on('gatheringDone', function(candidates) {
        console.log('gatheringDone', candidates);
        // send to remote stream stream.addRemoteIceCandidate(candidate)
        // on take stream.getLocalCredentials() and send to remote stream.setRemoteCredentials()
    });

    stream.on('stateChanged', function(component, state) {
        console.log('stateChanged', component, state);
        // 1) state === 'connecting'
        // 2) state === 'connected'
        // 3) state === 'ready'
    });

    stream.on('receive', function(component, data) {
        console.log('receive', component, data);
        // data packets
        // use stream.send(component, buffer) to transfer packets
    });

    stream.gatherCandidates();

    return stream;
}
