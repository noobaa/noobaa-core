/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const stream = require('stream');
const http_parser = process.binding('http_parser');
const HTTPParser = http_parser.HTTPParser;

const _cached_array_push = Array.prototype.push;

class HTTPRecorder extends stream.Writable {

    constructor(file_namer) {
        super();
        this.file_namer = file_namer;
        this.max_headers = 2000;
        this._parser = new HTTPParser(HTTPParser.REQUEST);
        this._start_message();
    }

    _start_message() {
        if (this._out_file) this._out_file.end();
        this._out_file = null;
        this._pending = [];
        this._parser.reinitialize(HTTPParser.REQUEST, true);

        let slow_url = '';
        let slow_headers = [];

        // `headers` and `url` are set only if .onHeaders() has not been called for
        // this request.
        // `url` is not set for response parsers but that's not applicable here since
        // all our parsers are request parsers.
        // eslint-disable-next-line max-params
        // eslint-disable-next-line no-bitwise
        this._parser[HTTPParser.kOnHeadersComplete | 0] = (
            versionMajor, versionMinor, headers, method, url,
            //eslint-disable-next-line max-params
            statusCode, statusMessage, upgrade, shouldKeepAlive) => {
            // console.log('kOnHeadersComplete',
            //     method, url, versionMajor, versionMinor,
            //     statusCode, statusMessage, upgrade, shouldKeepAlive, headers);
            const msg = {
                method: http_parser.methods[method],
                url: url || slow_url,
                headers: {},
                versionMajor,
                versionMinor,
                statusCode,
                statusMessage,
                upgrade,
                shouldKeepAlive,
            };
            const raw_headers = headers || slow_headers;
            for (let i = 0; i < raw_headers.length; i += 2) {
                const key = raw_headers[i].toLowerCase();
                const val = raw_headers[i + 1];
                const prev = msg.headers[key];
                msg.headers[key] = prev ? prev + ',' + val : val;
            }
            const file_name = this.file_namer(msg);
            console.log(`----> HTTPRecorder to ${file_name} message ${JSON.stringify(msg)}`);
            this._out_file = fs.createWriteStream(file_name);
            this._pending.forEach(buf => this._out_file.write(buf));
            this._pending = [];
        };

        // kOnHeaders is only called in the slow case where slow means
        // that the request headers were either fragmented
        // across multiple TCP packets or too large to be
        // processed in a single run. This method is also
        // called to process trailing HTTP headers.
        // Once we exceeded headers limit - stop collecting them
        // eslint-disable-next-line no-bitwise
        this._parser[HTTPParser.kOnHeaders | 0] = (headers, url) => {
            console.log('kOnHeaders', headers, url);
            slow_url += url;
            const add = headers.slice(0, this.max_headers - slow_headers.length);
            _cached_array_push.apply(slow_headers, add);
        };

        // eslint-disable-next-line no-bitwise
        this._parser[HTTPParser.kOnBody | 0] = (buf, start, len) => {
            // console.log('kOnBody', buf.length, start, len);
        };

        // eslint-disable-next-line no-bitwise
        this._parser[HTTPParser.kOnMessageComplete | 0] = () => {
            // console.log('kOnMessageComplete');
            this._start_message();
        };
    }

    _write(data, encoding, next) {
        let buf = encoding ? Buffer.from(data, encoding) : data;
        if (this._out_file) {
            this._out_file.write(buf);
        } else {
            this._pending.push(buf);
        }
        this._parser.execute(buf);
        return setImmediate(next);
    }

}

module.exports = HTTPRecorder;
