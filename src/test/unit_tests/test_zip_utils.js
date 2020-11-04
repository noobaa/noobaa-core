/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const chance = require('chance')();

const zip_utils = require('../../util/zip_utils');
const fs_utils = require('../../util/fs_utils');

mocha.describe('zip_utils', function() {

    var temp_dir;

    mocha.before(async function() {
        temp_dir = await fs.promises.mkdtemp('/tmp/test_zip_utils_');
    });

    mocha.after(async function() {
        if (temp_dir) await fs_utils.folder_delete(temp_dir);
    });

    mocha.it('should zip to buffer', async function() {
        const files = generate_files();
        const zipfile = await zip_utils.zip_from_files(files);
        const buffer = await zip_utils.zip_to_buffer(zipfile);
        assert(Buffer.isBuffer(buffer));
        const unzipfile = await zip_utils.unzip_from_buffer(buffer);
        const files2 = await zip_utils.unzip_to_mem(unzipfile);
        check_files(files, files2);
    });

    mocha.it('should zip to file', async function() {
        const files = generate_files();
        const fname = path.join(temp_dir, 'zip-to-file');
        const zipfile = await zip_utils.zip_from_files(files);
        await zip_utils.zip_to_file(zipfile, fname);
        const unzipfile = await zip_utils.unzip_from_file(fname);
        const files2 = await zip_utils.unzip_to_mem(unzipfile);
        check_files(files, files2);
    });

    mocha.it('should zip from dir', async function() {
        const files = generate_files();
        const dname = path.join(temp_dir, 'zip-from-dir');
        await fs_utils.create_path(dname);
        await Promise.all(files.map(async file => {
            await fs_utils.create_path(path.dirname(path.join(dname, file.path)));
            await fs.promises.writeFile(path.join(dname, file.path), file.data);
        }));
        const zipfile = await zip_utils.zip_from_dir(dname);
        const buffer = await zip_utils.zip_to_buffer(zipfile);
        assert(Buffer.isBuffer(buffer));
        const unzipfile = await zip_utils.unzip_from_buffer(buffer);
        const files2 = await zip_utils.unzip_to_mem(unzipfile);
        check_files(files, files2);
    });

    mocha.it('should unzip to dir', async function() {
        const files = generate_files();
        const files2 = [];
        const dname = path.join(temp_dir, 'unzip-to-dir');

        const zipfile = await zip_utils.zip_from_files(files);
        const buffer = await zip_utils.zip_to_buffer(zipfile);
        assert(Buffer.isBuffer(buffer));
        const unzipfile = await zip_utils.unzip_from_buffer(buffer);
        await zip_utils.unzip_to_dir(unzipfile, dname);
        await fs_utils.read_dir_recursive({
            root: dname,
            on_entry: async entry => {
                const relative_path = path.relative(dname, entry.path);
                if (!entry.stat.isFile()) return;
                const data = await fs.promises.readFile(entry.path);
                files2.push({ path: relative_path, data });
            }
        });
        check_files(files, files2);
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

/**
 * @param {number} len
 * @returns {string}
 */
function random_file_name(len) {
    return chance.string({ pool: file_name_charset });
}

/**
 * @param {string} range 
 * @returns {string}
 */
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
