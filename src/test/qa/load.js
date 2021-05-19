/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('chai').assert;

const P = require('../util/promise');
const os_utils = require('../util/os_utils');

const basic_size = 5;
const basic_name = 'file_' + Math.floor(Date.now() / 1000);
const end_point = 'localhost';

mocha.describe('UPLOAD TESTS:', function() {

    let index = 0;

    [basic_size, 10 * basic_size, 100 * basic_size].forEach(function(file_size) {
        let file_name = basic_name + index;
        index += 1;

        mocha.it('Upload single file of size:' + file_size + ' MB in one thread', async function() {
            console.info('> Uploading file: ' + file_name + ' to Noobaa with size of:' + file_size + ' MB');
            await os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --upload ' + file_name + ' --size ' + file_size);
            const reply = await os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --ls --prefix ' + file_name, {
                ignore_rc: false,
                return_stdout: true
            });
            assert.include(reply, file_name, 'file wasn\'t found in NooBaa!');
            console.info('> File: ' + file_name + ' was found on Noobaa');
            assert.include(reply, file_name, 'file size isn\'t correct!');
            console.info('> File size was correct');
        });
    });

    let file_name = 'file_' + (Math.floor(Date.now() / 1000) + 1);
    let file_size = 10;
    let num_of_files = 10;

    mocha.it('Upload multiple file of size:' + file_size + ' MB in different threads', function() {
        let promises = [];
        console.info('> Uploading ' + num_of_files + ' files to Noobaa in differnet threads');
        for (let i = 0; i < num_of_files; i++) {
            console.info('* Uploading file number ' + (i + 1) + ' out of ' + num_of_files + ' named: ' + (file_name + i));
            promises[i] = os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --upload ' + (file_name + i) + ' --size ' + file_size);
        }
        return P.all(promises)
            .then(() => os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --ls --prefix ' + file_name, {
                ignore_rc: false,
                return_stdout: true
            }))
            .then(reply => {
                var num_of_created = reply.split(/\r\n|\r|\n/).length - 1;
                assert.equal(num_of_created, num_of_files, 'Not all the files were created!, only ' + num_of_created);
                console.info('> Found ' + num_of_created + ' new files in NooBaa as should');
            });
        // .catch((err) => {
        //   console.error(err);
        // });
    });

    file_name = 'file_' + (Math.floor(Date.now() / 1000) + 2);
    file_size = 512; // 1/2GB
    let concur = 10; // number of multiparts used
    let part_size = Math.floor(file_size / concur);

    mocha.it('Upload one big file ' + file_size + ' using multi part', async function() {
        console.info('> Uploading file: ' + file_name + ' to Noobaa with size of:' + file_size + ' MB');
        await os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --upload ' + file_name + ' --size ' + file_size +
            ' --part_size ' + part_size + ' --concur ' + concur);
        const reply = await os_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --ls --prefix ' + file_name, {
            ignore_rc: false,
            return_stdout: true
        });
        assert.include(reply, file_name, 'file wasn\'t found in NooBaa!');
        console.info('> File: ' + file_name + ' was found on Noobaa');
        assert.include(reply, file_name, 'file size isn\'t correct!');
        console.info('> File size was correct');
    });
});
