/* Copyright (C) 2016 NooBaa */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

exports.handler = function(event, context, callback) {
    let text = '';

    if (event.random) {
        text = random_text(event.random);
        return callback(null, count_text(text, event.return_text));
    }

    if (event.text) {
        text = String(event.text);
        return callback(null, count_text(text, event.return_text));
    }

    if (event.url) {
        return (event.url.startsWith('https:') ? https : http)
            .get(event.url, res => res
                .setEncoding('utf8')
                .on('data', data => {
                    text += data;
                })
                .once('end', () => {
                    const reply = count_text(text, event.return_text);
                    reply.status_code = res.statusCode;
                    reply.headers = res.headers;
                    callback(null, reply);
                })
                .once('error', err => callback(err))
            )
            .once('error', err => callback(err));
    }

    return callback(new Error('WordCount: Bad Event'));
};

function count_text(text, return_text) {
    const words = text.match(/\S+/g);
    const lines = text.match(/\n/g);
    return {
        bytes: Buffer.byteLength(text),
        chars: text.length,
        words: words ? words.length : 0,
        lines: lines ? lines.length : 0,
        text: return_text ? text : undefined,
    };
}

function random_text(length) {
    let str = '';
    const WORDSET = 'abcdefghijklmnopqrstuvwxyz';
    const CHARSET = WORDSET + ' '.repeat(0.2 * WORDSET.length) + '\n'.repeat(0.1 * WORDSET.length);
    const cipher = crypto.createCipheriv('aes-128-gcm', crypto.randomBytes(16), crypto.randomBytes(12));
    const zero_buf = Buffer.alloc(Math.min(1024, length));
    while (length > 0) {
        const rand_buf = cipher.update(zero_buf);
        for (let i = 0; i < rand_buf.length; ++i) {
            const b = rand_buf[i];
            str += CHARSET[b % CHARSET.length];
        }
        length -= zero_buf.length;
    }
    return str;
}
