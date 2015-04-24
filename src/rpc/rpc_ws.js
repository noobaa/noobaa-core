'use strict';

// var _ = require('lodash');
var Q = require('q');
// var util = require('util');
// var buffer_utils = require('../util/buffer_utils');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);
var WS = require('ws');

dbg.set_level(config.dbg_log_level);

module.exports = {
    reusable: true,
    connect: connect,
    authenticate: authenticate,
    send: send,
    close: close,
    listen: listen,
};


/**
 *
 * connect
 *
 */
function connect(conn) {
    if (conn.ws) {
        return;
    }
    var defer = Q.defer();
    var ws = new WS(conn.address);
    conn.ws = ws;
    ws.onopen = function() {
        defer.resolve();
        setInterval(function() {
            ws.send('keepalive');
        }, 10000);
    };
    ws.onclose = function() {
        dbg.warn('WS CLOSED', conn.address);
        if (conn.ws === ws) {
            defer.reject();
            conn.ws = null;
            conn.emit('close');
        }
    };
    ws.onerror = function(err) {
        dbg.warn('WS ERROR', conn.address, err.stack || err);
        ws.close();
    };
    ws.onmessage = function(msg) {
        if (msg.data === 'keepalive') return;
        conn.receive(msg.data);
    };
    return defer.promise;
}


/**
 *
 * authenticate
 *
 */
function authenticate(conn, auth_token) {
    // TODO for now just save auth_token and send with every message, better send once
    conn.auth_token = auth_token;
}

var WS_SEND_OPTIONS = {
    binary: true,
    mask: false,
    compress: false
};

/**
 *
 * send
 *
 */
function send(conn, msg, op, reqid) {
    conn.ws.send(msg, WS_SEND_OPTIONS);
}

/**
 *
 * close
 *
 */
function close(conn) {
    conn.ws.close();
}

/**
 *
 * listen
 *
 */
function listen(rpc, http_server) {
    var ws_server = new WS.Server({
        server: http_server
    });
    ws_server.on('connection', function(ws) {
        var conn = rpc.new_connection('ws://' + ws.remoteHost + ':' + ws.remotePort);
        conn.ws = ws;
        ws.onclose = function() {
            dbg.warn('WS CLOSED', conn.address);
            if (conn.ws === ws) {
                conn.ws = null;
                conn.emit('close');
            }
        };
        ws.onerror = function(err) {
            dbg.warn('WS ERROR', conn.address, err.stack || err);
            ws.close();
        };
        ws.onmessage = function(msg) {
            if (msg.data === 'keepalive') return;
            conn.receive(msg.data);
        };
    });
    ws_server.on('error', function(err) {
        dbg.error('WS SERVER ERROR', err.stack || err);
    });
}
