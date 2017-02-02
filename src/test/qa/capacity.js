/* Copyright (C) 2016 NooBaa */
'use strict';

const promise_utils = require('../../util/promise_utils');
const P = require('../../util/promise');
const argv = require('minimist')(process.argv);
var file_names = [];

var prefix = argv.prefix || 'File';
var file_name = prefix + (Math.floor(Date.now() / 1000));
var num_of_threads = argv.threads || 50;
var num_of_files = argv.files || 500;
var size_of_files = argv.size || 128;
var bucket = argv.bucket || 'files';
var end_point = argv.server || '127.0.0.1';

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function(err) {
            console.log('Got error', err);
            process.exit(1);
        });
}

function run_test() {
    for (let i = 0; i < num_of_files; i++) {
        file_names[i] = {
            index: i,
            name: file_name + i
        };
    }
    return P.map(file_names, file => {
            console.info('> Uploading file number ' + file.index + ' out of ' + num_of_files + ' named: ' + file.name);
            console.info('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --bucket ' + bucket + ' --upload ' + file.name + ' --size ' + size_of_files);
            return promise_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --bucket ' + bucket + ' --upload ' + file.name + ' --size ' + size_of_files);
        }, {
            // limit concurrency with semaphore
            concurrency: num_of_threads
        })
        .delay(10000)
        .then(() => {
            console.info('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --bucket ' + bucket + ' --ls --prefix ' + file_name);
            return promise_utils.exec('node ' + process.cwd() + '/src/tools/s3cat.js --endpoint ' + end_point + ' --bucket ' + bucket + ' --ls --prefix ' + file_name, false, true);
        })
        .then(reply => {
            var num_of_created = reply.split(/\r\n|\r|\n/).length - 1;
            if (num_of_created === num_of_files) {
                console.info('> Found ' + num_of_created + ' new files in NooBaa as should 😎');
            } else {
                console.info('> Found ' + num_of_created + ' new files when was suppose to find ' + num_of_files + ' 💩');
            }
        });
}

if (require.main === module) {
    main();
}
