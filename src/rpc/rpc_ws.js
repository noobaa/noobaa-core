'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var buffer_utils = require('../util/buffer_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var WS = require('ws');

module.exports = {
    connect: connect,
    close: close,
    listen: listen,
    send: send,
    authenticate: authenticate,
};


/**
 *
 * connect
 *
 */
function connect(conn, options) {
    var ws = conn.ws;
    if (ws) {
        if (ws.connect_defer) {
            return ws.connect_defer.promise;
        }
        if (ws.connected) {
            return;
        }
        throw new Error('WS disconnected ' + conn.connid);
    }

    ws = new WS(conn.url.href);
    ws.connect_defer = Q.defer();
    ws.binaryType = 'arraybuffer';
    conn.ws = ws;

    ws.onopen = function() {

        // send connect command
        send_command('connect');

        // start keepaliving
        ws.keepalive_interval = setInterval(send_command, 10000, 'keepalive');

        ws.connected = true;

        if (ws.connect_defer) {
            ws.connect_defer.resolve();
            ws.connect_defer = null;
        }
    };

    ws.onclose = function() {
        dbg.warn('WS CLOSED', conn.connid);
        conn.emit('close');
    };

    ws.onerror = function(err) {
        dbg.error('WS ERROR', conn.connid, err.stack || err);
        conn.emit('error', err);
    };

    ws.onmessage = function(msg) {
        var buffer = buffer_utils.toBuffer(msg.data);
        conn.receive(buffer);
    };

    function send_command(op) {
        try {
            ws.send(JSON.stringify({
                op: op,
                time: conn.time,
                rand: conn.rand,
            }));
        } catch (err) {
            conn.emit('error', err);
        }
    }

    return ws.connect_defer.promise;
}


/**
 *
 * close
 *
 */
function close(conn) {
    var ws = conn.ws;

    if (!ws) {
        return;
    }

    ws.connected = false;

    if (ws.keepalive_interval) {
        clearInterval(ws.keepalive_interval);
        ws.keepalive_interval = null;
    }

    if (ws.connect_defer) {
        ws.connect_defer.reject('WS CLOSED');
        ws.connect_defer = null;
    }

    if (ws.readyState !== WS.CLOSED) {
        ws.close();
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
        var conn;
        var address = 'ws://' + ws._socket.remoteAddress + ':' + ws._socket.remotePort;
        dbg.log0('WS CONNECTION FROM', address);

        ws.on('close', function() {
            if (conn) {
                dbg.warn('WS CLOSED', conn.connid);
                conn.emit('close');
            } else {
                dbg.warn('WS CLOSED (not connected)', address);
            }
        });

        ws.on('error', function(err) {
            if (conn) {
                dbg.error('WS ERROR', conn.connid, err.stack || err);
                conn.emit('error', err);
            } else {
                dbg.error('WS ERROR (not connected)', address, err.stack || err);
                ws.emit('close', err);
            }
        });

        ws.on('message', function(msg, flags) {
            try {
                if (flags.binary) {
                    handle_data_message(msg);
                } else {
                    handle_command_message(msg);
                }
            } catch (err) {
                conn.emit('error', err);
            }
        });

        function handle_data_message(msg) {
            assert(conn, 'NOT CONNECTED');
            var buffer = buffer_utils.toBuffer(msg);
            conn.receive(buffer);
        }

        function handle_command_message(msg) {
            var cmd = _.isString(msg) ? JSON.parse(msg) : msg;
            dbg.log0('WS COMMAND', msg);
            switch (cmd.op) {
                case 'keepalive':
                    assert(conn, 'NOT CONNECTED');
                    assert.strictEqual(cmd.time, conn.time, 'CONNECTION TIME MISMATCH');
                    assert.strictEqual(cmd.rand, conn.rand, 'CONNECTION RAND MISMATCH');
                    break;
                case 'connect':
                    assert(!conn, 'ALREADY CONNECTED');
                    conn = rpc.new_connection(address, cmd.time, cmd.rand);
                    conn.ws = ws;
                    ws.connected = true;
                    break;
                default:
                    throw new Error('BAD MESSAGE');
            }
        }
    });

    ws_server.on('error', function(err) {
        dbg.error('WS SERVER ERROR', err.stack || err);
    });
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
    if (!conn.ws) {
        throw new Error('WS CLOSED cannot send ' + op + ' to ' + conn.url.href);
    }
    conn.ws.send(msg, WS_SEND_OPTIONS);
}


/**
 *
 * authenticate
 *
 */
function authenticate(conn, auth_token) {
    // TODO for now just save auth_token and send with every message, better send once
}
