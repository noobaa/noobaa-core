/* Copyright (C) 2016 NooBaa */
'use strict';

const tests = [
    // This test was commented out because of the need to re-evaluate if
    // the test is still relevant in k8s environments (Currently it will not run).
    // {
    //     name: 'test-node-failure',
    //     test: './src/test/system_tests/test_node_failure.js',
    //     server_cpu: '400m',
    //     server_mem: '400Mi',
    //     agent_cpu: '250m',
    //     agent_mem: '150Mi'
    // },
    {
        name: 'test-bucket-access',
        test: './src/test/system_tests/test_bucket_access',
        server_cpu: '400m',
        server_mem: '400Mi',
        agent_cpu: '250m',
        agent_mem: '250Mi'
    },
    {
        name: 'test-bucket-placement',
        test: './src/test/system_tests/test_bucket_placement.js',
        server_cpu: '400m',
        server_mem: '400Mi',
        agent_cpu: '250m',
        agent_mem: '150Mi',
        pv: true
    },
    // This test was commented out because of we need a reliable and fast way
    // to take down an agent on a statefulset pod (the current decommission action
    // results in a test that will always succeed).
    //
    // {
    //     name: 'test-build-chunks',
    //     test: './src/test/system_tests/test_build_chunks.js',
    //     server_cpu: '400m',
    //     server_mem: '400Mi',
    //     agent_cpu: '250m',
    //     agent_mem: '150Mi'
    // },
    {
        name: 'test-ceph-s3',
        test: './src/test/system_tests/test_ceph_s3.js',
        server_cpu: '400m',
        server_mem: '400Mi',
        agent_cpu: '250m',
        agent_mem: '150Mi'
    },
    {
        name: 'test-bucket-lambda-triggers',
        test: './src/test/system_tests/test_bucket_lambda_triggers.js',
        server_cpu: '400m',
        server_mem: '400Mi',
        agent_cpu: '250m',
        agent_mem: '150Mi'
    }
];

module.exports = tests;
