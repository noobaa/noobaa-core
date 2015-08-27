'use strict';

module.exports = NiceConnection;

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stun = require('./stun');
var dbg = require('../util/debug_module')(__filename);

try {
    var libnice = require('node-libnice');
} catch (err) {
    dbg.warn('libnice is unavailble');
}

util.inherits(NiceConnection, EventEmitter);

var global_nice_agent;

/**
 *
 * NiceConnection
 *
 * using libnice as a connector.
 *
 */
function NiceConnection(options) {
    var self = this;
    EventEmitter.call(self);
    self.addr_url = options.addr_url;
    self.signaller = options.signaller;

    // TODO is it right to use a global libnice agent and create stream per connection?
    if (!global_nice_agent) {
        global_nice_agent = new libnice.NiceAgent();
        global_nice_agent.setStunServer(
            stun.STUN.DEFAULT_SERVER.hostname,
            stun.STUN.DEFAULT_SERVER.port);
    }
}


/**
 *
 * connect
 *
 */
NiceConnection.prototype.connect = function() {
    var self = this;
    if (self.ready) {
        return;
    }
    if (self.accept_defer) {
        return self.accept_defer;
    }
    if (self.stream) {
        throw new Error('NICE invalid connect state');
    }
    self.connect_defer = P.defer();

    // create a nice-stream to be used for connecting.
    // 1 is number of components to init
    var stream = self.stream = global_nice_agent.createStream(1);

    stream.on('stateChanged', function(component, state) {
        dbg.log0('NICE connect: stateChanged', state);
        self.ready = false;
        switch (state) {
            case 'ready':
                self.ready = true;
                if (self.connect_defer) {
                    self.connect_defer.resolve();
                    self.connect_defer = null;
                }
                break;
            case 'connected':
            case 'connecting':
                break;
            default:
                setTimeout(function() {
                    if (self.connect_defer) {
                        self.connect_defer.reject('libnice ' + state);
                    }
                }, 10000);
                break;
        }
    });

    stream.on('receive', function(component, data) {
        self.emit('message', data);
    });

    stream.on('gatheringDone', function(candidates) {
        self.signaller({
                credentials: self.stream.getLocalCredentials(),
                candidates: self.stream.getLocalIceCandidates()
            })
            .then(function(info) {
                dbg.log0('NICE connect: signal response', info);
                self.stream.setRemoteCredentials(
                    info.credentials.ufrag,
                    info.credentials.pwd);
                _.each(info.candidates, function(candidate) {
                    self.stream.addRemoteIceCandidate(candidate);
                });
            })
            .then(null, function(err) {
                dbg.error('NICE connect: SIGNAL ERROR', err.stack || err);
                self.emit('error', err);
            });
    });

    self.stream.gatherCandidates();

    return self.connect_defer.promise;
};


/**
 *
 * accept
 *
 */
NiceConnection.prototype.accept = function(info) {
    var self = this;
    if (self.ready) {
        return;
    }
    if (self.accept_defer) {
        return self.accept_defer;
    }
    if (self.stream) {
        throw new Error('NICE invalid accept state');
    }
    self.accept_defer = P.defer();

    // create a nice-stream to be used for connecting.
    // 1 is number of components to init
    var stream = self.stream = global_nice_agent.createStream(1);

    stream.on('stateChanged', function(component, state) {
        dbg.log0('NICE accept: stateChanged', state);
        self.ready = false;
        switch (state) {
            case 'ready':
                self.ready = true;
                break;
            case 'connected':
            case 'connecting':
                break;
            default:
                setTimeout(function() {
                    if (self.accept_defer) {
                        self.accept_defer.reject('libnice ' + state);
                    }
                }, 10000);
                break;
        }
    });

    self.stream.on('receive', function(component, data) {
        self.emit('message', data);
    });

    self.stream.on('gatheringDone', function(candidates) {
        self.accept_defer.resolve({
            credentials: self.stream.getLocalCredentials(),
            candidates: self.stream.getLocalIceCandidates()
        });
        self.accept_defer = null;
    });

    self.stream.gatherCandidates();
    self.stream.setRemoteCredentials(
        info.credentials.ufrag,
        info.credentials.pwd);
    _.each(info.candidates, function(candidate) {
        self.stream.addRemoteIceCandidate(candidate);
    });

    return self.accept_defer.promise;
};


/**
 *
 * send
 *
 */
NiceConnection.prototype.send = function(msg) {
    this.stream.send(1, msg);
};


/**
 *
 * close
 *
 */
NiceConnection.prototype.close = function() {
    this.ready = false;
    this.stream.close();
    this.emit('close');
};
