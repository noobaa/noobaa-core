/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto = require('crypto');
const argv = require('minimist')(process.argv);
const size = argv.size_mb;
const cipher = crypto.createCipheriv('aes-128-gcm', crypto.randomBytes(16), crypto.randomBytes(12));
const zero_buf = Buffer.alloc(1024 * 1024);

const arr = [];
for (let index = 0; index < size; index++) {
    const buffer = cipher.update(zero_buf);
    arr.push(buffer);
}

// mem_grabber's whole purpose is to lock logical memory (RAM)
// size_mb - marks how many megabytes of RAM the process should lock
// Do not forget that there is a limit for node process RAM locking which you cannot exceed 
setInterval(() => {
    console.log('RUNNING LOOP');
}, 60000);
