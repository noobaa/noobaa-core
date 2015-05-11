'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var libnice = require('node-libnice');

module.exports = NiceConnection;

util.inherits(NiceConnection, EventEmitter);

var agent = new libnice.NiceAgent();
// agent.setStunServer(stun.STUN.PUBLIC_SERVERS[0].hostname, stun.STUN.PUBLIC_SERVERS[0].port);

function NiceConnection() {
    var self = this;
    EventEmitter.call(self);
}

NiceConnection.prototype.connect = function(options) {
    var self = this;
    if (self.stream) {
        return self.connect_defer;
    }
    self.connect_defer = Q.defer();

    // 1 is number of components to init
    var stream = self.stream = agent.createStream(1);

    stream.on('stateChanged', function(component, state) {
        switch (state) {
            case 'ready':
                self.connected = true;
                if (self.connect_defer) {
                    self.connect_defer.resolve();
                    self.connect_defer = null;
                }
                break;
            case 'connected':
            case 'connecting':
                break;
            default:
                if (self.connect_defer) {
                    self.connect_defer.reject(state);
                }
                break;
        }
    });

    stream.on('receive', function(component, data) {
        // data packets use stream.send(component, buffer) to transfer packets
        self.emit('message', data);
    });

    stream.on('gatheringDone', function(candidates) {
        // send to remote stream stream.addRemoteIceCandidate(candidate)
        // on take stream.getLocalCredentials() and send to remote stream.setRemoteCredentials()
        if (options && options.initiator) {
            self.emit('signal', self.get_signal());
        }
    });

    self.stream.gatherCandidates();

    if (options.n2n.signal) {
        self.signal(options.n2n.signal);
    }

};

NiceConnection.prototype.get_signal = function() {
    return {
        credentials: this.stream.getLocalCredentials(),
        candidates: this.stream.getLocalIceCandidates()
    };
};

NiceConnection.prototype.signal = function(msg) {
    var self = this;
    self.setRemoteCredentials(msg.credentials.ufrag, msg.credentials.pwd);
    _.each(msg.candidates, function(candidate) {
        self.stream.addRemoteIceCandidate(candidate);
    });
};

NiceConnection.prototype.send = function(msg) {
    this.stream.send(msg);
};

NiceConnection.prototype.close = function() {
    this.connected = false;
    this.stream.close();
    this.emit('close');
};
