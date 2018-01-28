/* Copyright (C) 2016 NooBaa */
'use strict';
const Auth = require('./api-auth');
const Parser = require('./api-request-parser');
const http = require('http');
const https = require('https');
const stream = require('stream');

class Requestor {
    constructor(requestorOptions) {
        this.requestorOptions = requestorOptions;
        if (!(this.requestorOptions instanceof Object)) {
            throw new TypeError('[Requestor Error] options should be an object');
        } else if (!(this.requestorOptions.hostname &&
                this.requestorOptions.keyName &&
                this.requestorOptions.key &&
                this.requestorOptions.ssl !== undefined)) {
            throw new Error('[Requestor Error] options object should contain key, keyName, hostname, and ssl attributes');
        }

        this.auth = new Auth({ key: this.requestorOptions.key, keyName: this.requestorOptions.keyName });
        this.parser = new Parser();
    }

    makeRequest(requestArgs, callback) {
        const acs_action = `version=1&action=${requestArgs.action}`;
        const netstoragePath = this.validatePath(requestArgs.path);
        const authData = this.auth.auth(netstoragePath, acs_action);

        var options = {
            method: requestArgs.method,
            host: this.requestorOptions.hostname,
            path: netstoragePath,
            headers: {
                'X-Akamai-ACS-Action': acs_action,
                'X-Akamai-ACS-Auth-Data': authData.acs_auth_data,
                'X-Akamai-ACS-Auth-Sign': authData.acs_auth_sign,
                'Accept-Encoding': 'identity',
                'User-Agent': 'NetStorageKit-Node'
            }
        };

        const request = (this.requestorOptions.ssl ? https : http).request(options);

        request.on('response', res => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            if (requestArgs.action === 'download' && ok) {
                return callback(null, res);
            } else {
                var buffers = [];
                res.on('data', data => buffers.push(data))
                    .on('end', () => {
                        res.body = Buffer.concat(buffers).toString('binary');
                        if (ok) {
                            this.parser.parse(res.body, (err, json) => {
                                if (err) return callback(err);
                                res.body = json;
                                return callback(null, res);
                            });
                        } else {
                            const err = new Error(`HTTP STATUS ${res.statusCode}: ${res.body}`);
                            // err.res = res;
                            return callback(err);
                        }
                    });
            }
        });

        request.on('error', err => callback(err));

        const source = requestArgs.source;
        if (source instanceof stream.Readable) {
            source
                .on('error', err => {
                    // TODO: Check the cancel working
                    request.cancel();
                    return callback(err);
                })
                .pipe(request);
        } else if (source) {
            request.end(source);
        } else {
            request.end();
        }

        return request;
    }

    validatePath(vpath) {
        this.path = vpath;
        if (!this.path.startsWith('/')) {
            return escape(`/${this.path}`);
        }
        return escape(this.path);
    }
}

module.exports = Requestor;
