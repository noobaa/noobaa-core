/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const yazl = require('yazl');
const yauzl = require('yauzl');

const P = require('./promise');
const fs_utils = require('./fs_utils');
const buffer_utils = require('./buffer_utils');

function zip_from_files(files) {
    const zipfile = new yazl.ZipFile();
    return P.resolve()
        .then(() => _.each(files, file => {
            if (file.data) {
                zipfile.addBuffer(file.data, file.path);
            } else if (file.stream) {
                zipfile.addReadStream(file.stream, file.path);
            } else {
                zipfile.addFile(file.fs_path || file.path, file.path);
            }
        }))
        .then(() => zipfile.end())
        .then(() => zipfile);
}

function zip_from_dir(dir) {
    const zipfile = new yazl.ZipFile();
    return P.resolve()
        .then(() => fs_utils.read_dir_recursive({
            root: dir,
            on_entry: entry => {
                const relative_path = path.relative(dir, entry.path);
                if (entry.stat.isFile()) {
                    zipfile.addFile(entry.path, relative_path);
                } else if (entry.stat.isDirectory()) {
                    zipfile.addEmptyDirectory(relative_path);
                }
            }
        }))
        .then(() => zipfile.end())
        .then(() => zipfile);
}

function zip_to_buffer(zipfile) {
    return buffer_utils.read_stream_join(zipfile.outputStream);
}

function zip_to_file(zipfile, file_path) {
    return fs_utils.write_file_from_stream(file_path, zipfile.outputStream);
}

const UNZIP_OPTIONS = Object.freeze({
    lazyEntries: true
});

function unzip_from_buffer(zip_buffer) {
    return P.fromCallback(cb => yauzl.fromBuffer(zip_buffer, UNZIP_OPTIONS, cb));
}

function unzip_from_file(file_path) {
    return P.fromCallback(cb => yauzl.open(file_path, UNZIP_OPTIONS, cb));
}

function unzip_to_callback(zipfile, on_entry) {
    return new Promise((resolve, reject) => zipfile
        .once('error', reject)
        .once('end', resolve)
        .on('entry', entry => P.resolve()
            .then(() => P.fromCallback(cb => zipfile.openReadStream(entry, cb)))
            .then(stream => on_entry(entry, stream))
            .then(() => zipfile.readEntry())
            .catch(err => zipfile.emit('error', err)))
        .readEntry()); // start reading entries
}

function unzip_to_mem(zipfile) {
    const files = [];
    return unzip_to_callback(zipfile, (entry, stream) =>
            buffer_utils.read_stream_join(stream)
            .then(buffer => {
                files.push({
                    path: entry.fileName.toString(),
                    data: buffer,
                });
            }))
        .then(() => files);
}

function unzip_to_dir(zipfile, dir) {
    return unzip_to_callback(zipfile, (entry, stream) => {
        const filename = entry.fileName.toString();
        const path_name = path.resolve(dir, '.' + path.sep + filename);
        // directory ends with '/'
        if (filename.endsWith('/')) {
            return fs_utils.create_path(path_name);
        }
        return P.resolve()
            .then(() => fs_utils.create_path(path.dirname(path_name)))
            .then(() => fs_utils.write_file_from_stream(path_name, stream));
    });
}

exports.zip_from_files = zip_from_files;
exports.zip_from_dir = zip_from_dir;
exports.zip_to_buffer = zip_to_buffer;
exports.zip_to_file = zip_to_file;

exports.unzip_from_buffer = unzip_from_buffer;
exports.unzip_from_file = unzip_from_file;
exports.unzip_to_mem = unzip_to_mem;
exports.unzip_to_dir = unzip_to_dir;
