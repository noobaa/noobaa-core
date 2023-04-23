/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const { Transform } = require('stream');
const nb_native = require('./nb_native');
const assert = require('assert');
const crc32 = require('crc-32');
const xml_utils = require('./xml_utils');

/*Encodes an s3select response according to AWS format. See
https://docs.aws.amazon.com/AmazonS3/latest/API/RESTSelectObjectAppendix.html*/

class S3SelectStream extends Transform {

    static prelude_length_bytes = 12;
    static crc_length_bytes = 4;
    static string_type = 7;
    static header_max_len = 256;

    static header_to_buffer(key, val) {
        assert(key.length < S3SelectStream.header_max_len);
        assert(val.length < S3SelectStream.header_max_len);
        return Buffer.concat([
            Buffer.from([key.length]),
            Buffer.from(key),
            Buffer.from([S3SelectStream.string_type, 0, val.length]),
            Buffer.from(val)
        ]);
    }

    //end message is always the same, so we allocate and init it once.
    static end_message = Buffer.concat([
        Buffer.from([0, 0, 0, 56]), //PRELUDE begins: total byte length
        Buffer.from([0, 0, 0, 40]), //headers byte length
        Buffer.from([0xc1, 0xc6, 0x84, 0xd4]), //crc of above (end of PRELUDE)
        //DATA begins, HEADERS begin
        S3SelectStream.header_to_buffer(':message-type', 'event'),
        S3SelectStream.header_to_buffer(':event-type', 'End'),
        //no PAYLOAD (DATA ends)
        Buffer.from([0xfe, 0x2c, 0xee, 0x99]) //MESSAGE CRC (crc of above)
    ]);

    //same for headers of records message
    static records_message_headers = Buffer.concat([
        S3SelectStream.header_to_buffer(':message-type', 'event'),
        S3SelectStream.header_to_buffer(':event-type', 'Records'),
        S3SelectStream.header_to_buffer(':content-type', 'application/octet-stream'),
    ]);

    //error message is always the same, so we allocate and init it once.
    static error_message = Buffer.concat([
        Buffer.from([0, 0, 0, 87]), //PRELUDE begins: total byte length
        Buffer.from([0, 0, 0, 71]), //headers byte length
        Buffer.from([0, 0, 0, 0]), //crc of above (end of PRELUDE)
        S3SelectStream.header_to_buffer(':message-type', 'error'),
        S3SelectStream.header_to_buffer(':error-code', '500'),
        S3SelectStream.header_to_buffer(':error-message', 'General Error'),
        //no PAYLOAD (DATA ends)
        Buffer.from([0, 0, 0, 0]) //MESSAGE CRC (crc of above)
    ]);

    //headers of stat message
    static stats_message_headers = Buffer.concat([
        S3SelectStream.header_to_buffer(':message-type', 'event'),
        S3SelectStream.header_to_buffer(':event-type', 'Stats'),
        S3SelectStream.header_to_buffer(':content-type', 'text/xml')
    ]);

    //calculate the two crcs (prelude and message) after content is filled
    static assign_crcs(message_buff) {
        //prelude crc (prelude is first 8 bytes) at offset 8
        message_buff.writeInt32BE(crc32.buf(message_buff.subarray(0, 8)), 8);
        //message crc (entire buffer except last 4 bytes) at last four bytes
        message_buff.writeInt32BE(crc32.buf(message_buff.subarray(0, message_buff.length - 4)), message_buff.length - 4);
    }

    //calculate crcs for the two static messages
    static {
        S3SelectStream.assign_crcs(S3SelectStream.end_message);
        S3SelectStream.assign_crcs(S3SelectStream.error_message);
    }

    /**
         * @param {{
    *     query: string;
    *     input_format: 'CSV' | 'JSON';
    *     input_serialization_format: {
    *        FieldDelimiter: string;
    *        RecordDelimiter: string;
    *        FileHeaderInfo: string;
    *     };
    *     records_header_buf: Buffer;
    *  }} opts
    */
    constructor(opts) {
        super(opts);
        this.stats = {
            Stats: {
                BytesProcessed: 0,
                BytesScanned: 0,
                BytesReturned: 0
            }
        };
        this.s3select = new (nb_native().S3Select)(opts);
    }

    encode_chunk(select_result) {
        dbg.log2("select res = ", select_result.select.toString());

        const total_length_bytes =
            select_result.select.length +
            S3SelectStream.records_message_headers.length +
            S3SelectStream.prelude_length_bytes +
            S3SelectStream.crc_length_bytes;
        const buffer = Buffer.alloc(S3SelectStream.prelude_length_bytes);
        let index = 0;

        this.stats.Stats.BytesReturned += select_result.select.length;

        //prelude:
        index = buffer.writeUInt32BE(total_length_bytes);
        index = buffer.writeUInt32BE(S3SelectStream.records_message_headers.length, index);
        buffer.writeInt32BE(select_result.prelude_crc, index);
        this.push(buffer);
        //headers:
        this.push(S3SelectStream.records_message_headers);
        //body:
        this.push(select_result.select);
        //message crc:
        const buffer2 = Buffer.alloc(S3SelectStream.crc_length_bytes);
        buffer2.writeInt32BE(select_result.message_crc);
        this.push(buffer2);

        //this transforms the buffer into a human-readable string.
        //it is not at any debug level because it is cpu-intensive and will be useful only in specific debug scenarios
        //dbg.log2("select content response = ", buffer.toString('hex').match(/../g).join(' '));
    }

    handle_result(result) {
        if (result) {
            this.encode_chunk(result);
        }
    }

    async send_stats() {
        const xml_buff = Buffer.from(xml_utils.encode_xml(this.stats));
        const total_length_bytes =
            xml_buff.length +
            S3SelectStream.stats_message_headers.length +
            S3SelectStream.prelude_length_bytes +
            S3SelectStream.crc_length_bytes;

        const buffer = Buffer.alloc(S3SelectStream.prelude_length_bytes);
        let index = 0;
        let message_crc = 0;

        //prelude:
        index = buffer.writeUInt32BE(total_length_bytes);
        index = buffer.writeUInt32BE(S3SelectStream.stats_message_headers.length, index);
        buffer.writeInt32BE(crc32.buf(buffer.subarray(0, index)), index);
        this.push(buffer);
        message_crc = crc32.buf(buffer);
        //headers:
        this.push(S3SelectStream.stats_message_headers);
        message_crc = crc32.buf(S3SelectStream.stats_message_headers, message_crc);
        //body:
        this.push(xml_buff);
        message_crc = crc32.buf(xml_buff, message_crc);
        //message crc:
        const buffer2 = Buffer.alloc(S3SelectStream.crc_length_bytes);
        buffer2.writeInt32BE(message_crc);
        this.push(buffer2);
    }

    async _transform(chunk, encoding, cb) {
        try {
            //note - no compression currently
            this.stats.Stats.BytesScanned += chunk.length;
            this.stats.Stats.BytesProcessed += chunk.length;
            const select_result = await this.s3select.write(chunk);
            this.handle_result(select_result);
            return cb();
        } catch (err) {
            dbg.error(err);
            return cb(err);
        }
    }

    async _flush(cb) {
        try {
            const select_result = await this.s3select.flush();
            this.handle_result(select_result);
            await this.send_stats();
            this.push(S3SelectStream.end_message);
            this.push(null); //ends http res
            return cb();
        } catch (err) {
            dbg.error(err);
            return cb(err);
        }
    }
}

exports.S3SelectStream = S3SelectStream;