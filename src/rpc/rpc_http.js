'use strict';

let _ = require('lodash');
let P = require('../util/promise');
let http = require('http');
let https = require('https');
let dbg = require('../util/debug_module')(__filename);
let RpcBaseConnection = require('./rpc_base_conn');

// dbg.set_level(5);

let BASE_PATH = '/rpc/';
let browser_location = global.window && global.window.location;
let is_browser_secure = browser_location && browser_location.protocol === 'https:';

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
        if (op === 'res') {
            return this.send_http_response(msg, req);
        } else {
            return this.send_http_request(msg, req);
        }
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
            _.each(msg, m => {
                res.write(m);
                return true; // keep iterating
            });
            res.end();
        } else {
            res.end(msg);
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
        let content_length = _.isArray(msg) ? _.sumBy(msg, 'length') : msg.length;
        headers['content-length'] = content_length;
        headers['content-type'] = 'application/octet-stream';

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

        let http_req = this.req =
            (http_options.protocol === 'https:') ?
            https.request(http_options) :
            http.request(http_options);

        dbg.log3('HTTP request', http_req.method, http_req.path, http_req._headers);

        let send_defer = P.defer();

        // reject on send errors
        http_req.on('error', send_defer.reject);

        // once a response arrives read and handle it
        http_req.on('response', http_res => this.handle_http_response(
            http_req, http_res, send_defer, rpc_req.reqid));

        // send the request data
        if (msg) {
            if (_.isArray(msg)) {
                _.each(msg, m => {
                    http_req.write(m);
                    return true; // keep iterating
                });
                http_req.end();
            } else {
                // dbg.log3('send_http_request: end2', msg.length);
                http_req.end(msg);
            }
        } else {
            http_req.end();
        }

        return send_defer.promise;
    }

    handle_http_request() {
        let req = this.req;
        let res = this.res;
        if (req.body) {
            this.emit('message', req.body);
            return;
        }
        RpcHttpConnection.read_http_data(req)
            .then(data => this.emit('message', data))
            .catch(err => {
                res.statusCode = 500;
                res.end(err);
            });
    }

    handle_http_response(req, res, send_defer, reqid) {
        // statusCode = 0 means ECONNREFUSED and the response
        // will not emit events in such case
        if (!res.statusCode) {
            send_defer.reject('ECONNREFUSED');
            return;
        }

        // sending is done, so resolve the send promise
        send_defer.resolve();

        // read the response data from the socket
        RpcHttpConnection.read_http_data(res)
            .then(data => {

                // the connection's req is done so no need to abort it on close no more
                this.req = null;

                if (res.statusCode !== 200) {
                    throw new Error('HTTP ERROR ' + res.statusCode + ' ' +
                        data + ' to ' + this.url.href);
                }
                dbg.log3('HTTP RESPONSE', res.statusCode, 'length', data.length);
                this.emit('message', data);
            })
            .catch(err => {

                // the connection's req is done so no need to abort it on close no more
                this.req = null;

                dbg.error('HTTP RESPONSE ERROR', err.stack || err);
                this.emit('message', {
                    header: {
                        op: 'res',
                        reqid: reqid,
                        error: err
                    }
                });
            });
    }


    /**
     *
     * read_http_data
     *
     * @param r http request or response object
     * @return promise for the data
     *
     */
    static read_http_data(r) {
        let chunks = [];
        let chunks_length = 0;
        dbg.log3('read_http_data: statusCode', r.statusCode, 'headers', r.headers);

        let defer = P.defer();
        r.on('error', defer.reject);
        r.on('data', add_chunk);
        r.on('end', finish);
        return defer.promise;

        function add_chunk(chunk) {
            dbg.log3('read_http_data: add_chunk', chunk.length,
                Buffer.isBuffer(chunk) ? 'buffer' : 'string');
            chunks.push(chunk);
            chunks_length += chunk.length;
        }

        function concat_chunks() {
            if (typeof(chunks[0]) === 'string') {
                // if string was already decoded then keep working with strings
                return String.prototype.concat.apply('', chunks);
            }
            // binary data buffers for the win!
            if (!Buffer.isBuffer(chunks[0])) {
                // in case of xhr arraybuffer just wrap with node buffers
                chunks = _.map(chunks, Buffer);
            }
            return Buffer.concat(chunks, chunks_length);
        }

        function decode_response(headers, data) {
            let content_type = headers && headers['content-type'];
            let is_json = _.includes(content_type, 'application/json');
            return is_json && data && JSON.parse(data.toString()) || data;
        }

        function finish() {
            dbg.log3('read_http_data: finish', chunks_length);
            try {
                let data = concat_chunks();
                data = decode_response(r.headers, data);
                defer.resolve(data);
            } catch (err) {
                defer.reject(err);
            }
        }
    }

}


module.exports = RpcHttpConnection;
