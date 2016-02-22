'use strict';

// let _ = require('lodash');
// let P = require('../util/promise');
let url = require('url');
let EventEmitter = require('events').EventEmitter;
let RpcWsConnection = require('./rpc_ws');
let dbg = require('../util/debug_module')(__filename);
let WS = require('ws');


/**
 *
 * RpcWsServer
 *
 */
class RpcWsServer extends EventEmitter {

    constructor(http_server) {
        super();

        let ws_server = new WS.Server({
            server: http_server
        });

        ws_server.on('connection', ws => {
            let conn;
            let address;
            try {
                // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
                address = url.format({
                    // TODO how to find out if ws is secure and use wss:// address instead
                    protocol: 'ws:',
                    slashes: true,
                    hostname: ws._socket.remoteAddress,
                    port: ws._socket.remotePort
                });
                let addr_url = url.parse(address);
                conn = new RpcWsConnection(addr_url);
                dbg.log0('WS ACCEPT CONNECTION', conn.connid);
                conn.emit('connect');
                conn._init_ws(ws);
                this.emit('connection', conn);
            } catch (err) {
                dbg.log0('WS ACCEPT ERROR', address, err.stack || err);
                close_ws(ws);
                if (conn) {
                    conn.emit('error', err);
                }
            }
        });

        ws_server.on('error', err => {
            dbg.error('WS SERVER ERROR', err.stack || err);
        });
    }
}


function close_ws(ws) {
    if (ws &&
        ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
}


module.exports = RpcWsServer;
