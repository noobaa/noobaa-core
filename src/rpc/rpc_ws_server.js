/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const EventEmitter = require('events').EventEmitter;
const RpcWsConnection = require('./rpc_ws');
const dbg = require('../util/debug_module')(__filename);
const WS = require('ws');


/**
 *
 * RpcWsServer
 *
 */
class RpcWsServer extends EventEmitter {

    constructor(http_server) {
        super();

        const ws_server = new WS.Server({
            server: http_server,
            perMessageDeflate: false,
        });

        ws_server.on('connection', ws => {
            let conn;
            let address;
            try {
                // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
                const socket = ws._socket;
                if (!socket) {
                    throw new Error('WS connection missing underlying socket');
                }
                const protocol = socket.encrypted ? 'wss:' : 'ws:';
                address = url.format({
                    protocol,
                    slashes: true,
                    hostname: socket.remoteAddress,
                    port: socket.remotePort
                });
                const addr_url = url.parse(address);
                conn = new RpcWsConnection(addr_url);
                dbg.log0('WS ACCEPT CONNECTION', conn.connid);
                conn._init(ws);
                conn.emit('connect');
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
