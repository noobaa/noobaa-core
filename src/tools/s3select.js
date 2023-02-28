/* Copyright (C) 2016 NooBaa */
'use strict';

const { S3Select } = require('../util/nb_native')();
const { Transform } = require('readable-stream');
const minimist = require('minimist');

const argv = minimist(process.argv, {
    default: {
        input_format: 'CSV',
        field_delimiter: ',',
        record_delimiter: '\n',
        file_header_info: 'IGNORE'
    }
});

class S3SelectStream extends Transform {

    constructor(opts = {}) {
        super(opts);
        const context = {
            query: argv.query,
            input_format: argv.input_format,
            input_serialization_format: {
                FieldDelimiter: argv.field_delimiter,
                RecordDelimiter: argv.record_delimiter,
                FileHeaderInfo: argv.file_header_info
            },
            records_header_buf: Buffer.from("don't care") /*Used for CRC, ignored here.*/
        };
        if (S3Select) {
            this.s3select = new S3Select(context);
        } else {
            console.log("ERROR - nb_native doesn't have S3Select. Did you build with GYP_DEFINES=BUILD_S3SELECT=1?");
            process.exit(1);
        }
    }

    async _transform(chunk, encoding, cb) {
        //console.log("got chunk ", chunk.length);
        let res = await this.s3select.write(chunk);
        if (res) {
            this.push(res.select);
        }
        return cb();
    }

    async _flush(cb) {
        //console.log("in flush");
        let res = await this.s3select.flush();
        if (res) {
            this.push(res.select);
        }
        return cb();
    }
}

const s3select = new S3SelectStream();
process.stdin.pipe(s3select).pipe(process.stdout);
