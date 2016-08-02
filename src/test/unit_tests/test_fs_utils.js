'use strict';

// var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');

// var P = require('../../util/promise');
var fs_utils = require('../../util/fs_utils');
var Semaphore = require('../../util/semaphore');

mocha.describe('fs_utils', function() {

    mocha.describe('disk_usage', function() {

        mocha.it('should work on the source dir', function() {
            const sem = new Semaphore(32);
            return fs_utils.disk_usage('./src', sem)
                .then(res => {
                    assert(res.size > 10 * 1024 * 1024, 'Your ./src  is small. Ha Ha Ha');
                    assert(res.count > 1000, 'Your ./src  is weak. Ha Ha Ha');
                });
        });

    });

});
