/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');

const STATE_READ_CHUNK_HEADER = 'STATE_READ_CHUNK_HEADER';
const STATE_WAIT_NL_HEADER = 'STATE_WAIT_NL_HEADER';
const STATE_SEND_DATA = 'STATE_SEND_DATA';
const STATE_WAIT_CR_DATA = 'STATE_WAIT_CR_DATA';
const STATE_WAIT_NL_DATA = 'STATE_WAIT_NL_DATA';
const STATE_READ_TRAILER = 'STATE_READ_TRAILER';
const STATE_WAIT_NL_TRAILER = 'STATE_WAIT_NL_TRAILER';
const STATE_WAIT_NL_END = 'STATE_WAIT_NL_END';
const STATE_CONTENT_END = 'STATE_CONTENT_END';
const STATE_ERROR = 'STATE_ERROR';

const CR_CODE = '\r'.charCodeAt(0);
const NL_CODE = '\n'.charCodeAt(0);

// lenient limits to avoid abuse
const MAX_CHUNK_SIZE = 1024 * 1024 * 1024 * 1024;
const MAX_CHUNK_HEADER_SIZE = 1024;
const MAX_TRAILER_SIZE = 1024;
const MAX_TRAILERS = 20;

/**
 *
 * ChunkedContentDecoder
 *
 * Take a data stream and removes chunking signatures from it
 *
 * Basic encoding structure: (combined with example)
 * More info about the structure can be found in:
 * https://en.wikipedia.org/wiki/Chunked_transfer_encoding
 * ---------------------------------------------------
 * 1fff;chunk-signature=1a2b\r\n   - chunk header (optional extension) <- 1fff is the size in hex
 * <1fff bytes of data>\r\n        - chunk data
 * 2fff;chunk-signature=1a2b\r\n   - chunk header (optional extension) <- 2fff is the size in hex
 * <2fff bytes of data>\r\n        - chunk data
 * 0\r\n                           - last chunk
 * <trailer>\r\n                   - optional trailer <- example of trailer (key:value): x-amz-checksum-crc32:uOMGCw==\r\n
 * <trailer>\r\n                   - optional trailer
 * \r\n                            - end of content
 * ---------------------------------------------------
 */
class ChunkedContentDecoder extends stream.Transform {

    constructor(params) {
        super(params);
        this.state = STATE_READ_CHUNK_HEADER;
        this.chunk_header = '';
        this.chunk_size = 0;
        this.last_chunk = false;
        this.trailer = '';
        this.trailers = [];
        this.stream_pos = 0;
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
        if (this.state !== STATE_CONTENT_END) return this.error_state(undefined, 0, '');
        return callback();
    }

    /**
     * Parse the buffer and update the state machine.
     * The buffer is parsed in a loop to handle multiple chunks in the same buffer,
     * and to handle the case where the buffer ends in the middle of a chunk.
     * The state machine is updated according to the current state and the buffer content.
     * The state machine is updated by the following rules:
     *   1. STATE_READ_CHUNK_HEADER - read the chunk header until CR and parse it.
     *   2. STATE_WAIT_NL_HEADER - wait for NL after the chunk header.
     *   3. STATE_SEND_DATA - send chunk data to the stream until chunk size bytes sent.
     *   4. STATE_WAIT_CR_DATA - wait for CR after the chunk data.
     *   5. STATE_WAIT_NL_DATA - wait for NL after the chunk data.
     *   6. STATE_READ_TRAILER - read optional trailer until CR and save it.
     *   7. STATE_WAIT_NL_TRAILER - wait for NL after non empty trailer.
     *   8. STATE_WAIT_NL_END - wait for NL after the last empty trailer.
     *   9. STATE_CONTENT_END - the stream is done.
     *  10. STATE_ERROR - an error occurred.
     * @param {Buffer} buf
     * @returns {boolean} false on error state
     */
    parse(buf) {
        for (let index = 0; index < buf.length; ++index) {

            //---------------//
            // header states //
            //---------------//

            if (this.state === STATE_READ_CHUNK_HEADER) {
                const { str, next, finished } = this.read_string_until_cr(buf, index);
                index = next;
                this.chunk_header += str;
                if (this.chunk_header.length > MAX_CHUNK_HEADER_SIZE) {
                    return this.error_state(buf, index,
                        `chunk_header exceeded MAX_CHUNK_HEADER_SIZE ${MAX_CHUNK_HEADER_SIZE}`);
                }
                if (finished) {
                    if (!this.parse_chunk_header(buf, index)) return false;
                    this.state = STATE_WAIT_NL_HEADER;
                }

            } else if (this.state === STATE_WAIT_NL_HEADER) {
                if (buf[index] !== NL_CODE) return this.error_state(buf, index, `expect NL`);
                if (this.last_chunk) {
                    this.state = STATE_READ_TRAILER;
                } else {
                    this.state = STATE_SEND_DATA;
                }

                //-------------//
                // data states //
                //-------------//

            } else if (this.state === STATE_SEND_DATA) {
                index = this.send_data(buf, index);
                if (!this.chunk_size) this.state = STATE_WAIT_CR_DATA;

            } else if (this.state === STATE_WAIT_CR_DATA) {
                if (buf[index] !== CR_CODE) return this.error_state(buf, index, `expect CR`);
                this.state = STATE_WAIT_NL_DATA;

            } else if (this.state === STATE_WAIT_NL_DATA) {
                if (buf[index] !== NL_CODE) return this.error_state(buf, index, `expect NL`);
                this.state = STATE_READ_CHUNK_HEADER;

                //----------------//
                // trailer states //
                //----------------//

            } else if (this.state === STATE_READ_TRAILER) {
                const { str, next, finished } = this.read_string_until_cr(buf, index);
                index = next;
                this.trailer += str;
                if (this.trailer.length > MAX_TRAILER_SIZE) {
                    return this.error_state(buf, index, `trailer exceeded MAX_TRAILER_SIZE ${MAX_TRAILER_SIZE}`);
                }
                if (finished) {
                    if (this.trailer) {
                        if (this.trailers.length >= MAX_TRAILERS) {
                            return this.error_state(buf, index, `number of trailers exceeded the MAX_TRAILERS ${MAX_TRAILERS}`);
                        }
                        this.trailers.push(this.trailer);
                        this.trailer = '';
                        this.state = STATE_WAIT_NL_TRAILER; // next trailer
                    } else {
                        this.state = STATE_WAIT_NL_END; // got last empty trailer
                    }
                }

            } else if (this.state === STATE_WAIT_NL_TRAILER) {
                if (buf[index] !== NL_CODE) return this.error_state(buf, index, `expect NL`);
                this.state = STATE_READ_TRAILER;

                //------------//
                // end states //
                //------------//

            } else if (this.state === STATE_WAIT_NL_END) {
                if (buf[index] !== NL_CODE) return this.error_state(buf, index, `expect NL`);
                this.state = STATE_CONTENT_END;

            } else {
                return this.error_state(buf, index, `State machine in an invalid state`);
            }
        }

        this.stream_pos += buf.length;
        return true;
    }

    /**
     * find index of next CR in this buffer, if exists,
     * and extracts the string from the current index to the CR index
     * @param {Buffer} buf
     * @param {number} index
     */
    read_string_until_cr(buf, index) {
        const start = index;
        while (index < buf.length && buf[index] !== CR_CODE) index += 1;
        const str = buf.toString('utf8', start, index);
        return { str, next: index, finished: index < buf.length };
    }

    /**
     * Parse the chunk size and extensions from `chunk_header`.
     * Will set error state if the chunk size is not a valid integer >= 0.
     * The buf and index are used for better debugging info.
     * Chunk header starts with a hex size and then optional extensions separated by ';'
     * 
     * Example: 0               - last chunk
     * Example: f00             - chunk length f00 = 3840 bytes
     * Example: 1ff;chunk-signature=1a2b3c4d
     * Example: 1000;a=1;b=2;c=3
     * 
     * @param {Buffer} buf
     * @param {number} index
     * @returns {boolean} false on error state
     */
    parse_chunk_header(buf, index) {
        const [chunk_size_hex, extension] = this.chunk_header.split(';', 2);
        const chunk_size = parseInt(chunk_size_hex, 16);
        if (isNaN(chunk_size) || chunk_size < 0 || chunk_size > MAX_CHUNK_SIZE) {
            return this.error_state(buf, index, `chunk_size has invalid value ${chunk_size}`);
        }
        if (extension) {
            // TODO check for chunk-signature
            // const [key, value] = extension.split('=', 2);
            // const chunk_signature = key === 'chunk-signature' ? value : undefined;
        }
        this.chunk_size = chunk_size;
        this.last_chunk = chunk_size === 0;
        this.chunk_header = '';
        return true;
    }

    /**
     * Send the chunk data to the stream.
     * @param {Buffer} buf
     * @param {number} index
     * @returns {number} next index
     */
    send_data(buf, index) {
        const content = (index === 0 && buf.length <= this.chunk_size) ?
            buf : buf.subarray(index, index + this.chunk_size);
        this.chunk_size -= content.length;
        if (content.length) this.push(content);
        return index + content.length - 1; // -1 because top loop increments
    }

    /**
     * Set the state to error and emit stream error.
     * The buf and index are used for better debugging info.
     * @param {Buffer|undefined} buf
     * @param {number} index
     * @param {string} [reason]
     * @returns {boolean} false, for easy return by caller on error
     */
    error_state(buf, index, reason = '') {
        // add index to stream_pos to get the exact position in the stream
        index ||= 0;
        this.stream_pos += index;
        const reason_statement = reason ? `due to ${reason} . ` : '';

        const message = `Failed parsing aws-chunked data ` + reason_statement + this.get_debug_info() +
            // since the state machine is changing according to each byte attached the buffer view of the next 10 bytes
            (buf ? ` buf[index..10]=[${buf.toString('hex', index, index + 10)}]` : '');

        this.state = STATE_ERROR;
        this.emit('error', new Error(message));
        return false;
    }

    get_debug_info() {
        const debug_info = `ChunkedContentDecoder:` +
            ` pos=${this.stream_pos}` +
            ` state=${this.state}` +
            ` chunk_header=${this.chunk_header}` +
            ` chunk_size=${this.chunk_size}` +
            ` last_chunk=${this.last_chunk}` +
            ` trailer=${this.trailer}` +
            ` trailers=${this.trailers}`;
            return debug_info;
    }

}

module.exports = ChunkedContentDecoder;
