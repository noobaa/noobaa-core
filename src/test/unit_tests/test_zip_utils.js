/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const chance = require('chance')();

const P = require('../../util/promise');
const zip_utils = require('../../util/zip_utils');
const fs_utils = require('../../util/fs_utils');

mocha.describe('zip_utils', function() {

    var temp_dir;

    mocha.before(function() {
        return fs.mkdtempAsync('/tmp/test_zip_utils_')
            .then(dir => {
                temp_dir = dir;
            });
    });

    mocha.after(function() {
        return temp_dir && fs_utils.folder_delete(temp_dir);
    });

    mocha.it('should zip to buffer', function() {
        const files = generate_files();
        return P.resolve()
            .then(() => zip_utils.zip_from_files(files))
            .then(zipfile => zip_utils.zip_to_buffer(zipfile))
            .then(buffer => assert(Buffer.isBuffer(buffer)) || buffer)
            .then(buffer => zip_utils.unzip_from_buffer(buffer))
            .then(zipfile => zip_utils.unzip_to_mem(zipfile))
            .then(files2 => check_files(files, files2));
    });
    mocha.it('should zip to file', function() {
        const files = generate_files();
        const fname = path.join(temp_dir, 'zip-to-file');
        return P.resolve()
            .then(() => zip_utils.zip_from_files(files))
            .then(zipfile => zip_utils.zip_to_file(zipfile, fname))
            .then(() => zip_utils.unzip_from_file(fname))
            .then(zipfile => zip_utils.unzip_to_mem(zipfile))
            .then(files2 => check_files(files, files2));
    });

    mocha.it('should zip from dir', function() {
        const files = generate_files();
        const dname = path.join(temp_dir, 'zip-from-dir');
        return P.resolve()
            .then(() => fs_utils.create_path(dname))
            .then(() => P.map(files, file =>
                fs_utils.create_path(path.dirname(path.join(dname, file.path)))
                .then(() => fs.writeFileAsync(path.join(dname, file.path), file.data))
            ))
            .then(() => zip_utils.zip_from_dir(dname))
            .then(zipfile => zip_utils.zip_to_buffer(zipfile))
            .then(buffer => assert(Buffer.isBuffer(buffer)) || buffer)
            .then(buffer => zip_utils.unzip_from_buffer(buffer))
            .then(zipfile => zip_utils.unzip_to_mem(zipfile))
            .then(files2 => check_files(files, files2));
    });

    mocha.it('should unzip to dir', function() {
        const files = generate_files();
        const files2 = [];
        const dname = path.join(temp_dir, 'unzip-to-dir');
        return P.resolve()
            .then(() => zip_utils.zip_from_files(files))
            .then(zipfile => zip_utils.zip_to_buffer(zipfile))
            .then(buffer => assert(Buffer.isBuffer(buffer)) || buffer)
            .then(buffer => zip_utils.unzip_from_buffer(buffer))
            .then(zipfile => zip_utils.unzip_to_dir(zipfile, dname))
            .then(() => fs_utils.read_dir_recursive({
                root: dname,
                on_entry: entry => {
                    const relative_path = path.relative(dname, entry.path);
                    if (!entry.stat.isFile()) return;
                    return fs.readFileAsync(entry.path)
                        .then(data => {
                            files2.push({
                                path: relative_path,
                                data,
                            });
                        });
                }
            }))
            .then(() => check_files(files, files2));
    });

});


function generate_files() {
    return [
        { path: 'dir/a', data: 'a file in dir' },
        { path: 'dir/b', data: 'b file in the same dir' },
        { path: 'random file data', data: crypto.randomBytes(100) },
        { path: random_file_name(30), data: 'random file name' },
    ];
}

function check_files(files, files2) {
    const files_sorted = _.sortBy(files, 'path');
    const files2_sorted = _.sortBy(files2.filter(f => !f.path.endsWith('/')), 'path');
    const l = Math.max(files_sorted.length, files2_sorted.length);
    for (var i = 0; i < l; ++i) {
        const file = files_sorted[i];
        const file2 = files2_sorted[i];
        assert.strictEqual(typeof file.path, 'string');
        assert.strictEqual(typeof file2.path, 'string');
        assert.strictEqual(file2.path, file.path);
        assert.deepStrictEqual(file2.data, Buffer.from(file.data));
    }
}

// See http://jrgraphix.net/research/unicode_blocks.php
const file_name_charset =
    charset_range('a-z') +
    charset_range('A-Z') +
    charset_range('0-9') +
    charset_range('א—ת') +
    ' ';

function random_file_name(len) {
    return chance.string({ pool: file_name_charset });
}

function charset_range(range) {
    var charset = '';
    const start = range.charCodeAt(0);
    const end = range.charCodeAt(2);
    assert(start <= end);
    for (var i = start; i <= end; ++i) {
        charset += String.fromCharCode(i);
    }
    return charset;
}
