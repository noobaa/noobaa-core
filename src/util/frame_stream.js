/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const buffer_utils = require('./buffer_utils');

const DEFAULT_MSG_MAGIC = "FramStrm";
const DEFAULT_MAX_MSG_LEN = 64 * 1024 * 1024;
const MAX_SEQ = 256 * 256; // 16 bit

/**
 * message framing for byte streams
 * loosely based on https://tools.ietf.org/html/rfc4571
 * insead of a 16bit length we use a frame header with:
 * - magic string to detect if the stream is out of sync
 * - sequence number to detect if the stream is out of sync
 * - optional message type
 * - 32bit length for messages (to support messages larger than 64KB)
 */
class FrameStream {

    constructor(stream, msg_handler, config) {
        this.stream = stream;
        this.msg_handler = msg_handler || function(msg, msg_type) {
            stream.emit('message', msg, msg_type);
        };
        this._magic = (config && config.magic) || DEFAULT_MSG_MAGIC;
        this._magic_len = this._magic.length;
        this._max_len = (config && config.max_len) || DEFAULT_MAX_MSG_LEN;
        // eslint-disable-next-line no-bitwise
        this._send_seq = (MAX_SEQ * Math.random()) | 0;
        this._recv_seq = NaN;
        this._header_len = this._magic_len + 8;
        this._buffers = [];
        this._buffers_length = 0;
        stream.on('data', data => this._on_data(data));
    }

    /**
     * support iovecs
     */
    send_message(buffers, message_type_code_16bit) {
        try {
            this._send_message(buffers, message_type_code_16bit);
        } catch (err) {
            this.stream.emit('error', err);
            throw err;
        }
    }

    /**
     * optimized version of send_message - without try-catch that forces v8 deoptimization
     */
    _send_message(buffers, message_type_code_16bit) {
        var msg_len = _.sumBy(buffers, 'length');
        if (msg_len > this._max_len) {
            throw new Error('message too big' + msg_len);
        }
        var msg_header = Buffer.allocUnsafe(this._header_len);
        msg_header.write(this._magic, 0, this._magic_len, 'ascii');
        msg_header.writeUInt16BE(this._send_seq, this._magic_len);
        msg_header.writeUInt16BE(message_type_code_16bit || 0, this._magic_len + 2);
        msg_header.writeUInt32BE(msg_len, this._magic_len + 4);
        this._send_seq += 1;
        if (this._send_seq >= MAX_SEQ) {
            this._send_seq = 0;
        }

        // when writing we ignore 'false' return value
        // that indicates that the internal buffer is full, since the data here
        // is already in memory waiting to be sent, so we don't really need
        // another level of buffering and just prefer to push it forward.
        //
        // in addition, we also don't pass a callback function to write,
        // because we prefer the errors to be handled by the stream error event.
        //
        // we tried to use stream.cork()/uncork() surrounding the writes,
        // but there was no noticeable effect.
        this.stream.write(msg_header);
        for (var i = 0; i < buffers.length; ++i) {
            this.stream.write(buffers[i]);
        }
    }

    _on_data(data) {
        this._buffers.push(data);
        this._buffers_length += data.length;
        var run = true;
        while (run) {
            // read the message header if not already read
            if (!this._msg_header) {

                // check if we have enough bytes to extract the header
                if (this._buffers_length < this._header_len) {
                    run = false;
                    return;
                }

                this._buffers_length -= this._header_len;
                this._msg_header = buffer_utils.extract_join(this._buffers, this._header_len);
                var magic = this._msg_header.slice(0, this._magic_len).toString();
                var seq = this._msg_header.readUInt16BE(this._magic_len);

                // verify the magic
                if (magic !== this._magic) {
                    this.stream.emit('error', new Error('received magic mismatch ' +
                        magic + ' expected ' + this._magic));
                    run = false;
                    return;
                }

                // verify the sequence
                if (isNaN(this._recv_seq)) {
                    this._recv_seq = seq;
                } else {
                    var recv_seq = this._recv_seq + 1;
                    if (recv_seq >= MAX_SEQ) {
                        recv_seq = 0;
                    }
                    if (recv_seq === seq) {
                        this._recv_seq = seq;
                    } else {
                        this.stream.emit('error', new Error('received seq mismatch ' +
                            seq + ' expected ' + (this._recv_seq + 1)));
                        run = false;
                        return;
                    }
                }
            }

            // get the expected message length from the header
            var msg_len = this._msg_header.readUInt32BE(this._magic_len + 4);

            // verify it doesn't exceed the maximum to avoid errors
            // that will cost in lots of memory
            if (msg_len > this._max_len) {
                this.stream.emit('error', new Error('received message too big ' +
                    msg_len + ' expected up to ' + this._max_len));
                run = false;
                return;
            }

            // check if we have enough bytes to extract the message
            if (this._buffers_length < msg_len) {
                run = false;
                return;
            }

            // got a complete message, remove the previous header and emit
            this._buffers_length -= msg_len;
            var msg = buffer_utils.extract(this._buffers, msg_len);
            var msg_type = this._msg_header.readUInt16BE(this._magic_len + 2);
            this._msg_header = null;
            this.msg_handler(msg, msg_type);
        }
    }
}

module.exports = FrameStream;
