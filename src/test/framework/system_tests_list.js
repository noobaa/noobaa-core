/* Copyright (C) 2016 NooBaa */
'use strict';

const tests = [{
    name: 'test-node-failure',
    test: './src/test/system_tests/test_node_failure.js',
    num_agents: 0,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, {
    name: 'test-bucket-access',
    test: './src/test/system_tests/test_bucket_access',
    num_agents: 3,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '250Mi'
}, {
    name: 'test-bucket-placement',
    test: './src/test/system_tests/test_bucket_placement.js',
    num_agents: 6,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
    pv: true
}, {
    name: 'test-build-chunks',
    test: './src/test/system_tests/test_build_chunks.js',
    num_agents: 7,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, {
    name: 'test-ceph-s3',
    test: './src/test/system_tests/test_ceph_s3.js',
    num_agents: 3,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, {
    name: 'test-bucket-lambda-triggers',
    test: './src/test/system_tests/test_bucket_lambda_triggers.js',
    num_agents: 3,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, ];

module.exports = tests;
