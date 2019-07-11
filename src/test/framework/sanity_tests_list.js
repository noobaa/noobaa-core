/* Copyright (C) 2016 NooBaa */
'use strict';

// This test list is used as a basic sanity test list

const tests = [{
    name: 'sanity-build-test',
    test: './src/test/system_tests/sanity_build_test',
    server_cpu: '400m',
    server_mem: '400Mi',
}];

module.exports = tests;
