/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');

var fs_utils = require('../../util/fs_utils');

function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}

mocha.describe('fs_utils', function() {
    const self = this; // eslint-disable-line no-invalid-this

    //Disk usage sometimes takes a bit more than 1sec, and causes inconsistency
    self.timeout(10000);

    mocha.describe('disk_usage', function() {

        mocha.it('should work on the src', function() {
            return Promise.all([fs_utils.disk_usage('src/server'),
                fs_utils.disk_usage('src/test')
            ]).then(([server_usage, test_usage]) => {
                log('disk_usage of src:', server_usage);
                log('disk_usage of src/test:', test_usage);
                assert(test_usage.size / server_usage.size > 0.50,
                    'disk usage size of src/test is less than 50% of src/server,',
                    'what about some quality :)');
                assert(test_usage.count / server_usage.count > 0.50,
                    'disk usage count of src/test is less than 50% of src/server,',
                    'what about some quality :)');
            });
        });

    });

    mocha.describe('read_dir_recursive', function() {

        mocha.it('should find this entry in source dir', function() {
            let found = false;
            return fs_utils.read_dir_recursive({
                    root: 'src/test',
                    on_entry: entry => {
                        if (entry.path.endsWith('test_fs_utils.js')) {
                            found = true;
                        }
                    }
                })
                .then(() => {
                    assert(found, 'Failed to find this test file in the src/test');
                });
        });

    });

});
