/* Copyright (C) 2016 NooBaa */
'use strict';

// DO NOT REQUIRE our modules here otherwise it will not be instrumented

const path = require('path');

let _instrumenter;
const basepath = path.resolve(__dirname, '..', '..', '..');
const regexp = new RegExp('^' + basepath + '/(node_modules|src/deploy|src/util/mongo_functions)');
const COVERAGE_VARIABLE = 'NOOBAA_COV';

function _on_load() {
    for (let i = 0; i < process.argv.length; ++i) {
        if (process.argv[i] === '--TESTRUN') {
            _setup_hook();
        }
    }
}

function _setup_hook() {
    if (_instrumenter) return;

    const istanbul_lib_hook = require('istanbul-lib-hook'); // eslint-disable-line global-require
    const istanbul_lib_instrument = require('istanbul-lib-instrument'); // eslint-disable-line global-require

    _instrumenter = istanbul_lib_instrument.createInstrumenter({
        coverageVariable: COVERAGE_VARIABLE
    });

    istanbul_lib_hook.hookRequire(_matcher, _transformer);
}

function _matcher(file) {
    if (file.match(regexp)) {
        return false;
    }
    return true;
}

function _transformer(code, file) {
    if (file.startsWith(basepath)) {
        file = file.slice(basepath.length + 1); // +1 for / seperator
    }
    return _instrumenter.instrumentSync(code, file);
}

function get_coverage_data() {
    if (!_instrumenter) return;
    return global[COVERAGE_VARIABLE];
}

class CoverageReport {

    constructor() {

        this.istanbul_lib_coverage = require('istanbul-lib-coverage'); // eslint-disable-line global-require
        this.istanbul_lib_report = require('istanbul-lib-report'); // eslint-disable-line global-require
        this.istanbul_reports = require('istanbul-reports'); // eslint-disable-line global-require

        // creating empty coverage map, will merge all coverage data into it for global coverage stats
        this.map = this.istanbul_lib_coverage.createCoverageMap();
    }

    add_data(data) {
        // create new map to merge into the collection coverage map
        this.map.merge(this.istanbul_lib_coverage.createCoverageMap(data));
    }

    write({
        report_dir,
        report_type = 'text',
        tree_type = 'pkg'
    }) {
        // istanbul file writes are sync, so no need for promise
        const context = this.istanbul_lib_report.createContext({ dir: report_dir });
        const reporter = this.istanbul_reports.create(report_type);
        const summarizer = this.istanbul_lib_report.summarizers[tree_type];
        const tree = summarizer(this.map);
        tree.visit(reporter, context);
    }

}

exports.get_coverage_data = get_coverage_data;
exports.CoverageReport = CoverageReport;

_on_load();
