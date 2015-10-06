'use strict';

var _ = require('lodash');

module.exports = FrameStream;

const DEFAULT_MSG_MAGIC = "FramStrm";
const DEFAULT_MAX_MSG_LEN = 4 * 1024 * 1024;
const MAX_SEQ = (1 << 16);

/**
 * message framing for byte streams
 * loosely based on https://tools.ietf.org/html/rfc4571
 * insead of a 16bit length we use a frame header with:
 * - magic string to detect if the stream is out of sync
 * - sequence number to detect if the stream is out of sync
 * - optional message type
 * - 32bit length for messages (to support messages larger than 64KB)
 */
function FrameStream(stream, msg_handler, config) {
    this.stream = stream;
    this.msg_handler = msg_handler;
    this._magic = config.magic || DEFAULT_MSG_MAGIC;
    this._magic_len = this._magic.length;
    this._max_len = config.max_len || DEFAULT_MAX_MSG_LEN;
    this._send_seq = (MAX_SEQ * Math.random()) >>> 0;
    this._recv_seq = NaN;
    this._header_len = this._magic_len + 8;

    var self = this;
    stream.on('readable', function() {
        self._on_readable();
    });
}

/**
 * support iovecs
 */
FrameStream.prototype.send_message = function(buffer_or_buffers, message_type_code_16bit) {
    var msg_len = _.sum(buffer_or_buffers, 'length');
    if (msg_len > this._max_len) {
        throw new Error('message too big' + msg_len);
    }
    var msg_header = new Buffer(this._header_len);
    msg_header.write(this._magic, 0, this._magic_len, 'ascii');
    msg_header.writeUInt16BE(this._send_seq, this._magic_len);
    msg_header.writeUInt16BE(message_type_code_16bit || 0, this._magic_len + 2);
    msg_header.writeUInt32BE(msg_len, this._magic_len + 4);
    this._send_seq += 1;
    if (this._send_seq >= MAX_SEQ) {
        this._send_seq = 0;
    }

    // when writing  we ignore the return value of false
    // (that indicates that the internal buffer is full) since the data here
    // is already in memory waiting to be sent, so we don't really need
    // another level of buffering and just prefer to push it forward.
    //
    // in addition, we also don't pass a callback function to write,
    // because we prefer the errors to be handled by the stream error event.
    try {
        this.stream.write(msg_header);
        if (_.isArray(buffer_or_buffers)) {
            for (var i = 0; i < buffer_or_buffers.length; ++i) {
                this.stream.write(buffer_or_buffers[i]);
            }
        } else {
            this.stream.write(buffer_or_buffers);
        }
    } catch (err) {
        this.stream.emit('error', err);
        throw err;
    }
};

FrameStream.prototype._on_readable = function() {
    while (true) {

        // read the message header if not already read
        if (!this._msg_header) {

            // the stream read will only return the buffer if it has
            // the amount of requested bytes, otherwise will return null
            // and not extract any bytes, so will be kept in the buffer for next
            // 'readable' event.
            this._msg_header = this.stream.read(this._header_len);
            if (!this._msg_header) return;

            // verify the magic
            var magic = this._msg_header.slice(0, this._magic_len).toString();
            if (magic !== this._magic) {
                this.stream.emit('error', new Error('received magic mismatch ' +
                    magic + ' expected ' + this._magic));
                return;
            }

            // verify the sequence
            var seq = this._msg_header.readUInt16BE(this._magic_len);
            if (isNaN(this._recv_seq)) {
                this._recv_seq = seq;
            } else {
                var recv_seq = this._recv_seq + 1;
                if (recv_seq > MAX_SEQ) {
                    recv_seq = 0;
                }
                if (recv_seq === seq) {
                    this._recv_seq = seq;
                } else {
                    this.stream.emit('error', new Error('received seq mismatch ' +
                        seq + ' expected ' + (this._recv_seq + 1)));
                    return;
                }
            }
        }

        // get the expected message length from the header,
        // verify it doesn't exceed the maximum to avoid errors
        // that will cost in lots of memory
        var msg_len = this._msg_header.readUInt32BE(this._magic_len + 4);
        if (msg_len > this._max_len) {
            this.stream.emit('error', new Error('received message too big ' +
                msg_len + ' expected up to ' + this._max_len));
            return;
        }

        // try to get the entire message from the stream buffer
        // if not available, will wait for next 'readable' event
        var msg = this.stream.read(msg_len);
        if (!msg) return;

        // got a complete message, remove the previous header and emit
        var msg_type = this._msg_header.readUInt16BE(this._magic_len + 2);
        this._msg_header = null;
        this.msg_handler(msg, msg_type);
    }
};
