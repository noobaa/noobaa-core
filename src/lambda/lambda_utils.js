/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const yazl = require('yazl');
const yauzl = require('yauzl');

const P = require('../util/promise');

function zip_in_memory(files) {
    const chunks = [];
    return new P((resolve, reject) => {
            const zipfile = new yazl.ZipFile();
            zipfile.once('error', reject);
            zipfile.outputStream.on('data', chunk => chunks.push(chunk));
            zipfile.outputStream.once('error', reject);
            zipfile.outputStream.once('end', resolve);
            _.each(files, (buffer, name) => zipfile.addBuffer(buffer, name));
            zipfile.end();
        })
        .then(() => Buffer.concat(chunks));
}

function unzip_in_memory(zip_buffer) {
    const files = {};
    return P.fromCallback(callback => yauzl.fromBuffer(zip_buffer, {
            lazyEntries: true
        }, callback))
        .then(zipfile => new P((resolve, reject) => {
            zipfile.once('error', reject);
            zipfile.once('end', resolve);
            zipfile.on('entry', ent => {
                zipfile.openReadStream(ent, function(err, read_stream) {
                    if (err) return reject(err);
                    const chunks = [];
                    read_stream.on('data', chunk => chunks.push(chunk));
                    read_stream.once('error', reject);
                    read_stream.once('end', () => {
                        files[ent.fileName] = Buffer.concat(chunks);
                        zipfile.readEntry(); // read next entry
                    });
                });
            });
            zipfile.readEntry(); // start reading entries
        }))
        .return(files);
}

exports.zip_in_memory = zip_in_memory;
exports.unzip_in_memory = unzip_in_memory;
