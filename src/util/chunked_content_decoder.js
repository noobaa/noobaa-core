/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');

const STATE_READ_CHUNK_HEADER = 'STATE_READ_CHUNK_HEADER';
const STATE_WAIT_NL_HEADER = 'STATE_WAIT_NL_HEADER';
const STATE_SEND_DATA = 'STATE_SEND_DATA';
const STATE_WAIT_CR_DATA = 'STATE_WAIT_CR_DATA';
const STATE_WAIT_NL_DATA = 'STATE_WAIT_NL_DATA';
const STATE_CONTENT_END = 'STATE_CONTENT_END';
const STATE_ERROR = 'STATE_ERROR';

const CR_CODE = '\r'.charCodeAt(0);
const NL_CODE = '\n'.charCodeAt(0);

/**
 *
 * ChunkedContentDecoder
 *
 * Take a data stream and removes chunking signatures from it
 *
 */
class ChunkedContentDecoder extends stream.Transform {

    constructor(params) {
        super(params);
        this.state = STATE_READ_CHUNK_HEADER;
        this.chunk_header_str = '';
        this.chunk_size = 0;
        this.chunk_signature = '';
    }

    _transform(buf, encoding, callback) {
        try {
            this.parse(buf);
            return callback();
        } catch (err) {
            return callback(err);
        }
    }

    _flush(callback) {
        if (this.state !== STATE_CONTENT_END) return this.error_state();
        return callback();
    }

    parse(buf) {
        for (let index = 0; index < buf.length; ++index) {
            if (this.state === STATE_READ_CHUNK_HEADER) {
                for (; index < buf.length; ++index) {
                    if (buf[index] === CR_CODE) {
                        const header_items = this.chunk_header_str.split(';');
                        this.chunk_size = parseInt(header_items[0], 16);
                        if (!(this.chunk_size >= 0)) return this.error_state();
                        this.last_chunk = this.chunk_size === 0;
                        const header1 = header_items[1].split('=');
                        this.chunk_signature = header1[0] === 'chunk-signature' ? header1[1] : '';
                        this.chunk_header_str = '';
                        this.state = STATE_WAIT_NL_HEADER;
                        break;
                    } else {
                        this.chunk_header_str += String.fromCharCode(buf[index]);
                    }
                }
            } else if (this.state === STATE_WAIT_NL_HEADER) {
                if (buf[index] !== NL_CODE) return this.error_state();
                this.state = STATE_SEND_DATA;
            } else if (this.state === STATE_SEND_DATA) {
                const content = (index === 0 && buf.length <= this.chunk_size) ? buf : buf.slice(index, index + this.chunk_size);
                this.chunk_size -= content.length;
                index += content.length - 1;
                if (content.length) this.push(content);
                if (!this.chunk_size) this.state = STATE_WAIT_CR_DATA;
            } else if (this.state === STATE_WAIT_CR_DATA) {
                if (buf[index] !== CR_CODE) return this.error_state();
                this.state = STATE_WAIT_NL_DATA;
            } else if (this.state === STATE_WAIT_NL_DATA) {
                if (buf[index] !== NL_CODE) return this.error_state();
                if (this.last_chunk) {
                    this.state = STATE_CONTENT_END;
                } else {
                    this.state = STATE_READ_CHUNK_HEADER;
                }
            } else {
                return this.error_state();
            }
        }
    }

    error_state() {
        this.state = STATE_ERROR;
        this.emit('error', new Error('problem in parsing aws-chunked data'));
    }
}

module.exports = ChunkedContentDecoder;
