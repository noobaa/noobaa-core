/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const { Transform } = require('stream');
const nb_native = require('./nb_native');
const assert = require('assert');

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
        S3SelectStream.header_to_buffer(':event-type', 'End'),
        S3SelectStream.header_to_buffer(':message-type', 'event'),
        //no PAYLOAD (DATA ends)
        Buffer.from([0xfe, 0x2c, 0xee, 0x99]) //MESSAGE CRC (crc of above)
    ]);

    //same for headers of records message
    static records_message_headers = Buffer.concat([
        S3SelectStream.header_to_buffer(':event-type', 'Records'),
        S3SelectStream.header_to_buffer(':content-type', 'application/octet-stream'),
        S3SelectStream.header_to_buffer(':message-type', 'event'),
    ]);

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

    async _transform(chunk, encoding, cb) {
        try {
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