/* Copyright (C) 2016 NooBaa */
'use strict';

// This test list is used as a basic sanity test list

const tests = [{
    name: 'namespace-cache-test',
    test: './src/test/pipeline/run_namespace_cache_tests',
    server_cpu: '400m',
    server_mem: '400Mi',
}];

module.exports = tests;
