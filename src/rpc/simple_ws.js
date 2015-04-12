'use strict';

var _ = require('lodash');
var Q = require('q');
var WS = require('ws');
var util = require('util');
var buffer_utils = require('./buffer_utils');
var EventEmitter = require('events').EventEmitter;
var dbg = require('./debug_module')(__filename);

module.exports = SimpleWS;

var STATE_INIT = 'init';
var STATE_HANDSHAKE = 'handshake';
var STATE_READY = 'ready';

util.inherits(SimpleWS, EventEmitter);

/**
 * Wrapper for WebSocket with several convenient features:
 * - emit messages - register with on('message', function(data) {...})
 * - send and receive binary ArrayBuffer or JSON (handles parsing/encoding)
 * - reconnects on close/error
 * - optional keepalive - set options.keepalive = {
 *          data: {...},
 *          delay: 10000
 *      }
 * - optional handshake on open - set options.handshake = {
 *          data: {...},
 *          accept: function(data) { can return promise }
 *      }
 */
function SimpleWS(options) {
    EventEmitter.call(this);
    this._options = options;
    this._name = options.name || '';
    this._keepalive = options.keepalive;
    this._handshake = options.handshake;
    this._ws = null;
    this._state = STATE_INIT;
    this._init_timeout = null;
    process.nextTick(this._init.bind(this));
}

/**
 * public send() function

 */
SimpleWS.prototype.send = function(data) {
    var self = this;
    return Q.fcall(function() {
        if (self._state !== STATE_READY) {
            dbg.warn('WS NOT READY', self._name, self._state);
            throw new Error('WS NOT READY');
        }
        return self._sendData(data);
    });
};

/**
 *
 */
SimpleWS.prototype._sendData = function(data) {

    // convert data to ArrayBuffer or JSON string
    if (Buffer.isBuffer(data)) {
        data = buffer_utils.toArrayBuffer(data);
    } else if (!(data instanceof ArrayBuffer)) {
        data = JSON.stringify(data);
    }

    // exceptions from send should call the socket's error handler
    dbg.log('WS SEND', this._name, data);
    this._ws.send(data);
};

/**
 *
 */
SimpleWS.prototype._reset = function() {
    this._ws = null;
    this._state = STATE_INIT;
    clearTimeout(this._keepalive_timeout);
    this._keepalive_timeout = null;
    // call init but not immediate to avoid tight error loops
    this._init_timeout = this._init_timeout ||
        setTimeout(this._init.bind(this), 1000);
};

/**
 *
 */
SimpleWS.prototype._init = function() {
    if (this._init_timeout) {
        clearTimeout(this._init_timeout);
        this._init_timeout = null;
    }
    var ws = new WS(this._options.address);
    ws.onerror = this._onWsError.bind(this, ws);
    ws.onclose = this._onWsClose.bind(this, ws);
    ws.onopen = this._onWsOpen.bind(this, ws);
    ws.onmessage = this._onWsMessage.bind(this, ws);
    this._ws = ws;
};

/**
 *
 */
SimpleWS.prototype._onWsOpen = function(ws) {
    if (this._ws !== ws) {
        dbg.log('IGNORE OLD WS OPENED');
        ws.close();
        return;
    }
    this._triggerKeepalive();
    if (this._handshake) {
        this._sendHandshake();
    } else {
        dbg.log0('WS READY', this._name);
        this._state = STATE_READY;
    }
};

/**
 *
 */
SimpleWS.prototype._onWsMessage = function(ws, event) {
    if (this._ws !== ws) {
        dbg.log('IGNORE OLD WS MESSAGE', this._name);
        ws.close();
        return;
    }

    var data = event.data;
    if (!event.binary) {
        try {
            data = JSON.parse(data);
        } catch (err) {
            dbg.error('WS JSON PARSE ERROR', this._name, event.data);
            this._onWsError(ws, err);
            return;
        }
    }

    switch (this._state) {
        case STATE_READY:
            dbg.log0('WS MESSAGE', this._name, event.data);
            this.emit('message', data);
            break;
        case STATE_HANDSHAKE:
            this._acceptHandshake(ws, data);
            break;
        default:
            dbg.error('WS MESSAGE ON BAD STATE', this._name, this._state);
            this._onWsError(ws, new Error('WS MESSAGE ON BAD STATE'));
            break;
    }
};

/**
 *
 */
SimpleWS.prototype._sendHandshake = function() {
    dbg.log0('WS HANDSHAKE', this._name);
    this._sendData(this._handshake.data);
    this._state = STATE_HANDSHAKE;
};

/**
 *
 */
SimpleWS.prototype._acceptHandshake = function(ws, data) {
    var self = this;
    dbg.log0('WS HANDSHAKE ACCEPT', self._name);
    Q.fcall(self._handshake.accept || noop, data)
        .then(function() {
            self._state = STATE_READY;
        }, function(err) {
            dbg.error('WS HANDSHAKE ACCEPT ERROR', self._name);
            self._onWsError(ws, err);
        });
};

/**
 *
 */
SimpleWS.prototype._sendKeepalive = function() {
    dbg.log('WS KEEPALIVE', this._name);
    this._ws.send(this._keepalive.data);
    this._triggerKeepalive();
};

/**
 *
 */
SimpleWS.prototype._triggerKeepalive = function() {
    if (this._keepalive) {
        this._keepalive_timeout = setTimeout(
            this._sendKeepalive.bind(this),
            this._keepalive.delay || 10000);
    } else {

    }
};

/**
 *
 */
SimpleWS.prototype._onWsError = function(ws, err) {
    dbg.error('WS ERROR', this._name, err.stack || err);
    ws.close();
    if (this._ws === ws) {
        this._reset();
    }
};

/**
 *
 */
SimpleWS.prototype._onWsClose = function(ws) {
    if (this._ws !== ws) {
        dbg.log('OLD WS CLOSED', this._name);
        return;
    }
    dbg.error('WS CLOSED', this._name);
    this._reset();
};

function noop() {}
