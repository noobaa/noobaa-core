'use strict';

// var _ = require('lodash');
var Q = require('q');
// var util = require('util');
var buffer_utils = require('../util/buffer_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var WS = require('ws');

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
        return conn.ws.connect_defer && conn.ws.connect_defer.promise;
    }
    var ws = new WS(conn.address);
    ws.connect_defer = Q.defer();
    ws.binaryType = 'arraybuffer';
    conn.ws = ws;
    ws.onopen = function() {
        if (conn.ws === ws) {
            if (ws.connect_defer) {
                ws.connect_defer.resolve();
                ws.connect_defer = null;
            }
            ws.keepalive_interval = setInterval(function() {
                ws.send('keepalive');
            }, 10000);
        }
    };
    ws.onclose = function() {
        dbg.warn('WS CLOSED', conn.address);
        clearInterval(ws.keepalive_interval);
        ws.keepalive_interval = null;
        if (conn.ws === ws) {
            if (ws.connect_defer) {
                ws.connect_defer.reject();
                ws.connect_defer = null;
            }
            conn.ws = null;
            // we call the connection close just to emit the event,
            // since we already closed and nullified the socket itself
            conn.close();
        }
    };
    ws.onerror = function(err) {
        dbg.warn('WS ERROR', conn.address, err.stack || err);
        ws.close();
    };
    ws.onmessage = function(msg) {
        if (msg.data === 'keepalive') return;
        var buffer = buffer_utils.toBuffer(msg.data);
        conn.receive(buffer);
    };
    return ws.connect_defer.promise;
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
function send(conn, msg, op, req) {
    conn.ws.send(msg, WS_SEND_OPTIONS);
}

/**
 *
 * close
 *
 */
function close(conn) {
    if (conn.ws) {
        conn.ws.close();
    }
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
        // TODO find out if ws is secure and use wss:// address instead
        var address = 'ws://' + ws._socket.remoteAddress + ':' + ws._socket.remotePort;
        dbg.log0('WS CONNECTION FROM', address);
        var conn = rpc.new_connection(address);
        conn.ws = ws;
        ws.onclose = function() {
            dbg.warn('WS CLOSED', conn.address);
            if (conn.ws === ws) {
                conn.ws = null;
                conn.close();
            }
        };
        ws.onerror = function(err) {
            dbg.warn('WS ERROR', conn.address, err.stack || err);
            ws.close();
        };
        ws.onmessage = function(msg) {
            if (msg.data === 'keepalive') return;
            var buffer = buffer_utils.toBuffer(msg.data);
            conn.receive(buffer);
        };
    });
    ws_server.on('error', function(err) {
        dbg.error('WS SERVER ERROR', err.stack || err);
    });
}
