'use strict';

var _ = require('lodash');
var Q = require('q');
var WS = require('ws');
var EventEmitter = require('events').EventEmitter;
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');

module.exports = SignalClient;

var STATE_INIT = 'init';
var STATE_IDENTITY = 'identity';
var STATE_READY = 'ready';

/**
 *
 */
function SignalClient(peerId) {
    this._peerId = peerId;
    this._ws = null;
    this._state = STATE_INIT;
    this._signalEvents = new EventEmitter();
    process.nextTick(this._init.bind(this));
}

/**
 *
 */
SignalClient.prototype.signal = function(from, to, data) {
    return Q.fcall(function() {
        if (this._state !== STATE_READY) {
            throw new Error('WS BAD STATE');
        }
        console.log('SIGNAL WS send signal from', from, 'to', to);
        this._ws.send(JSON.stringify({
            op: 'signal',
            from: from,
            to: to,
            data: data
        }));
    });
};

/**
 *
 */
SignalClient.prototype._init = function() {
    var ws = new WS(config.signal_address);
    ws.onerror = this._onWsError.bind(this, ws);
    ws.onclose = this._onWsClose.bind(this, ws);
    ws.onopen = this._onWsOpen.bind(this, ws);
    ws.onmessage = this._onWsMessage.bind(this, ws);
    this._ws = ws;
    this._state = STATE_INIT;
};

/**
 *
 */
SignalClient.prototype._onWsOpen = function(ws) {
    if (this._ws !== ws) {
        dbg.log('IGNORE OLD WS OPENED');
        ws.close();
        return;
    }

    dbg.log0('SIGNAL WS OPENED');
    this._ws.send(JSON.stringify({
        op: 'identity',
        id: this.peerId
    }));
    this._state = STATE_IDENTITY;
};

/**
 *
 */
SignalClient.prototype._onWsMessage = function(ws, event) {
    if (this._ws !== ws) {
        dbg.log('IGNORE OLD WS MESSAGE');
        ws.close();
        return;
    }

    dbg.log0('SIGNAL WS message', event.data);
    var msg = JSON.parse(event.data);
    msg.op = String(msg.op);

    switch (msg.op) {
        case 'identity':
            this._onIdentity(msg);
            break;
        case 'signal':
            this._signalEvents.emit('signal', msg);
            break;
        default:
            dbg.error('SIGNAL WS BAD OP', msg);
            this._onWsError(this._ws, new Error('SIGNAL WS BAD OP'));
            break;
    }
};

/**
 *
 */
SignalClient.prototype._onIdentity = function(msg) {
    if (this._state !== STATE_IDENTITY) {
        dbg.log('IDENTITY STATE MISMATCH', this._state);
        this._onWsError(this._ws, new Error('IDENTITY STATE MISMATCH'));
        return;
    }

    this._state = STATE_READY;
    this._identity = msg.id;
};

/**
 *
 */
SignalClient.prototype._onWsError = function(ws, err) {
    dbg.error('SIGNAL WS error', err.stack || err);
    ws.close();
    if (this._ws === ws) {
        Q.delay(1000).then(this._init.bind(this));
    }
};

/**
 *
 */
SignalClient.prototype._onWsClose = function(ws) {
    if (this._ws !== ws) {
        dbg.log('OLD WS CLOSED');
        return;
    }
    dbg.error('SIGNAL WS CLOSED');
    Q.delay(1000).then(this._init.bind(this));
};
