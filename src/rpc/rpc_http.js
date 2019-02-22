/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const http = require('http');
const https = require('https');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const buffer_utils = require('../util/buffer_utils');
const RpcBaseConnection = require('./rpc_base_conn');
const { RPC_VERSION_NUMBER, RPC_VERSION_HEX } = require('./rpc_request');

// dbg.set_level(5);

const BASE_PATH = '/rpc/';
const browser_location = global.window && global.window.location;
const is_browser_secure = browser_location && browser_location.protocol === 'https:';

// increase the maximum sockets per host, the default is 5 which is low
if (http.globalAgent && http.globalAgent.maxSockets < 100) {
    http.globalAgent.maxSockets = 100;
}
// same for http-browserify
if (http.Agent && http.Agent.defaultMaxSockets < 100) {
    http.Agent.defaultMaxSockets = 100;
}


/**
 *
 * RpcHttpConnection
 *
 */
class RpcHttpConnection extends RpcBaseConnection {

    // constructor(addr_url) { super(addr_url); }

    /**
     * mark to rpc that this connection is transient
     * because we create http connection per request
     */
    get transient() {
        return true;
    }

    static get BASE_PATH() {
        return BASE_PATH;
    }

    /**
     *
     * connect
     *
     */
    _connect() {
        // there is not real need to connect http connections
        // as the actual connection is managed by the nodejs http module
        // so we only manage a transient request-response.
        // see the transient = true handling
        if (this.url.protocol === 'http:' && is_browser_secure) {
            throw new Error('HTTP INSECURE - cannot use http: from secure browser page');
        }
        setImmediate(() => this.emit('connect'));
    }


    /**
     *
     * close
     *
     */
    _close() {
        // try to abort the connetion's running request
        if (this.req) {
            if (this.req.abort) {
                dbg.warn('HTTP ABORT REQ', this.reqid);
                this.req.abort();
            }
            this.req = null;
        }
    }


    /**
     *
     * send
     *
     */
    _send(msg, op, req) {
        return op === 'res' ?
            this.send_http_response(msg, req) :
            this.send_http_request(msg, req);
    }


    /**
     *
     * send_http_response
     *
     */
    send_http_response(msg, req) {
        let res = this.res;
        if (!res) {
            throw new Error('HTTP RESPONSE ALREADY SENT ' + req.reqid);
        }
        res.statusCode = 200;
        if (_.isArray(msg)) {
            buffer_utils.extract(msg, 8);
            for (const m of msg) res.write(m);
            res.end();
        } else {
            res.end(msg.slice(8));
        }
        this.res = null;
    }


    /**
     *
     * send_http_request
     *
     */
    send_http_request(msg, rpc_req) {
        let headers = {};

        // set the url path only for logging to show it
        let path = BASE_PATH + rpc_req.srv;

        // use POST for all requests (used to be req.method_api.method but unneeded),
        // and send the body as binary buffer
        let http_method = 'POST';
        let content_length = _.sumBy(msg, 'length');
        headers['content-length'] = content_length;
        headers['content-type'] = 'application/json';
        headers['x-noobaa-rpc-version'] = RPC_VERSION_HEX;

        let http_options = {
            protocol: this.url.protocol,
            hostname: this.url.hostname,
            port: this.url.port,
            method: http_method,
            path: path,
            headers: headers,
            // accept self signed ssl certificates
            rejectUnauthorized: false,
            // turn off withCredentials for browser xhr requests
            // in order to use allow-origin=* (CORS)
            withCredentials: false,
            // tell browserify http module to use binary data
            responseType: 'arraybuffer'
        };

        let http_req =
            (http_options.protocol === 'https:') ?
            https.request(http_options) :
            http.request(http_options);
        this.req = http_req;

        dbg.log3('HTTP request', http_req.method, http_req.path, http_req._headers);

        let send_defer = P.defer();

        // reject on send errors
        http_req.on('error', send_defer.reject);

        // once a response arrives read and handle it
        http_req.on('response', http_res => this.handle_http_response(
            http_req, http_res, send_defer, rpc_req.reqid));

        // send the request data
        for (let i = 0; i < msg.length; ++i) {
            http_req.write(msg[i]);
        }
        http_req.end();

        return send_defer.promise;
    }

    /**
     * Called by RpcHttpServer
     */
    async handle_http_request() {
        try {
            const meta_buffer = Buffer.allocUnsafe(8);
            const version_header = this.req.headers['x-noobaa-rpc-version'] || '*';
            const rpc_version = version_header === '*' ? RPC_VERSION_NUMBER : Number(version_header);
            const { buffers, total_length } = await buffer_utils.read_stream(this.req);
            meta_buffer.writeUInt32BE(rpc_version, 0);
            meta_buffer.writeUInt32BE(total_length, 4);
            this.emit('message', [meta_buffer, ...buffers]);
        } catch (err) {
            dbg.error('handle_http_request: ERROR', err.stack || err);
            this.res.statusCode = 500;
            this.res.end(err.message);
        }
    }

    async handle_http_response(req, res, send_defer, reqid) {
        // statusCode = 0 means ECONNREFUSED and the response
        // will not emit events in such case
        if (!res.statusCode) {
            send_defer.reject(new Error('HTTP ECONNREFUSED'));
            return;
        }

        // sending is done, so resolve the send promise
        send_defer.resolve();

        try {
            // read the response data from the socket
            const read_res = await buffer_utils.read_stream(res);
            // the connection's req is done so no need to abort it on close no more
            this.req = null;
            if (res.statusCode !== 200) {
                throw new Error('HTTP ERROR ' + res.statusCode + ' to ' + this.url.href);
            }
            dbg.log3('HTTP RESPONSE', res.statusCode, 'length', read_res.total_length);
            this.emit('message', read_res.buffers);
        } catch (err) {
            // the connection's req is done so no need to abort it on close no more
            this.req = null;
            dbg.error('HTTP RESPONSE ERROR', err.stack || err);
            this.emit('error', err);
        }
    }

}


module.exports = RpcHttpConnection;
