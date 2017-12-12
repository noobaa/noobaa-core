/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mocha = require('mocha');
// const assert = require('assert');

process.env.TESTRUN = 'true';
const coverage_utils = require('../../util/coverage_utils');

mocha.describe('coverage_utils', function() {

    this.timeout(10000); // eslint-disable-line no-invalid-this

    mocha.it('writes to console', function() {
        const report = new coverage_utils.CoverageReport();
        report.add_data({});
        report.write({});
    });

    mocha.it('writes to dir', function() {
        const report = new coverage_utils.CoverageReport();
        report.add_data({});
        report.write({ report_dir: './coverage', report_type: 'lcov' });
    });

});
