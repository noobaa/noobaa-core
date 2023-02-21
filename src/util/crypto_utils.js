/* Copyright (C) 2023 NooBaa */
'use strict';

const crypto = require('crypto');
const stream = require('stream');

function new_md5_stream() {
    const md5_stream = new stream.Transform({
        transform(buf, encoding, next) {
            this.md5.update(buf);
            this.size += buf.length;
            next(null, buf);
        }
    });

    md5_stream.md5 = crypto.createHash('md5');
    md5_stream.size = 0;
    md5_stream.md5_buf = null;

    return md5_stream;
}

function calc_body_md5(stream_file) {
    const md5_stream = new_md5_stream();
    const new_stream = stream_file.pipe(md5_stream);
    return {
        new_stream,
        md5_buf: () => {
            if (md5_stream.md5_buf) return md5_stream.md5_buf;

            const final_md5 = md5_stream.md5.digest('hex');
            md5_stream.md5_buf = Buffer.from(final_md5, 'hex');

            return md5_stream.md5_buf;
        }
    };
}

exports.new_md5_stream = new_md5_stream;
exports.calc_body_md5 = calc_body_md5;
