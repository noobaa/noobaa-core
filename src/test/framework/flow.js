/* Copyright (C) 2016 NooBaa */
'use strict';

var steps = [
    //Upgrade moved externally to be run from the jenkins prior to the framework run
    {
        name: 'Clean Server for Run',
        common: 'clean_server_for_run',
    },
    {
        //Run FE Unit tests
        name: 'FE Unit Tests',
        action: 'gulp',
        params: [{
            arg: '--cwd'
        }, {
            arg: 'frontend'
        }, {
            arg: 'test'
        }]
    },
    {
        //Run BE Unit tests
        name: 'BE Unit Tests',
        action: 'npm',
        params: [{
            arg: 'run',
        }, {
            arg: 'mocha:coverage',
        }],
        env: {
            COVDIR: './report/cov/mocha',
            PATH: process.env.PATH,
            DEV_MODE: 'true'
        }
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Placement according to policy
        name: 'Data Placement Test',
        lib_test: '/src/test/system_tests/test_bucket_placement',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Rebuild and Eviction
        name: 'Rebuild and Eviction Test',
        lib_test: '/src/test/system_tests/test_build_chunks',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Cloud Sync Test',
        lib_test: '/src/test/system_tests/test_cloud_sync',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Node Failure Test',
        lib_test: '/src/test/system_tests/test_node_failure',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Bucket Access Test',
        lib_test: '/src/test/system_tests/test_bucket_access',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Ceph S3
        name: 'Ceph S3 Test',
        lib_test: '/src/test/system_tests/test_ceph_s3',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Cloud Pools
        name: 'Cloud Pools Test',
        lib_test: '/src/test/system_tests/test_cloud_pools',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test MD Aggregator
        name: 'MD Aggregator Test',
        lib_test: '/src/test/system_tests/test_md_aggregator',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }
];

module.exports = steps;

/*Example Step:
{
  name: 'Some Name',
  action: 'node src/some_file.js' OR common 'function name' OR lib_test '/src/sometest'
  params: if exists, array of args
      [
        arg: 'value',
        input_arg: argument name of arg which was sent to the runner
      ]
  blocking: if true, will stop execution on failure of this step
}
*/
