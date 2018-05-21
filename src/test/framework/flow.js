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
        ignore_failure: true,
        name: 'FE Unit Tests',
        action: 'gulp',
        params: [{
            arg: '--cwd'
        }, {
            arg: 'frontend'
        }, {
            arg: 'test'
        }],
    },
    {
        //Run BE Unit tests
        name: 'BE Unit Tests',
        action: 'npm',
        params: [{
            arg: 'run',
        }, {
            arg: 'mocha', // TODO: restore mocha:coverage
            // arg: 'mocha:coverage',
        }],
        env: {
            npm_package_config_covdir: './report/cov/mocha',
            PATH: process.env.PATH,
            DEV_MODE: 'true'
        },
    },
    {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Placement according to policy
        name: 'Data Placement Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_bucket_placement'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Rebuild and Eviction
        name: 'Rebuild and Eviction Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_build_chunks'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Node Failure Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_node_failure'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Bucket Access Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_bucket_access',
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Ceph S3
        name: 'Ceph S3 Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_ceph_s3'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Cloud Pools
        action: 'node',
        name: 'Cloud Pools Test',
        ignore_failure: true,
        params: [{
            arg: './src/test/system_tests/test_cloud_pools'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Bucket Lambda Triggers Test
        name: 'Bucket Lambda Triggers Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_bucket_lambda_triggers'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Bucket Lambda Triggers Test
        name: 'Blob API Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_blob_api'
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test MD Aggregator
        name: 'MD Aggregator Test',
        action: 'node',
        params: [{
            arg: './src/test/system_tests/test_md_aggregator'
        }],
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
  ignore_failure: if true the test will only report fail\pass without failing the run
}
*/
