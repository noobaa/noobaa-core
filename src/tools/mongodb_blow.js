/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global HexData */
'use strict';

/*
 * mongodb script to add massive ammount of chunks to DB
 *
 * usage: mongo nbcore mongodb_blow.js
 *
 */
function random_hex_char() {
    const hexchars = "0123456789abcdef";
    return hexchars[Math.floor(_rand() * 16)];
}

function random_hex_string(n) {
    let s = "";
    for (let i = 0; i < n; ++i) {
        s += random_hex_char();
    }
    return s;
}

const system = db.systems.findOne()._id;
const bucket = db.buckets.findOne()._id;

for (let j = 0; j < 10000; ++j) {
    const array_of_chunks = [];
    for (let i = 0; i < 1000; ++i) {
        const digest_b64 = new HexData(0, random_hex_string(96)).base64();
        array_of_chunks.push({
            _id: new ObjectId(),
            system,
            bucket,
            size: 1048576,
            digest_type: "test",
            digest_b64: digest_b64,
            dedup_key: digest_b64,
            data_frags: 1,
            lrc_frags: 0,
        });
    }
    db.datachunks.insert(array_of_chunks);
}
