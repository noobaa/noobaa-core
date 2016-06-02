var steps = [
    //Upgrade moved externally to be run from the jenkins prior to the framework run
    {
        //Run unit tests
        name: 'Unit Tests',
        action: './node_modules/.bin/gulp',
        params: [{
            arg: 'mocha',
        }, {
            arg: '--COV_DIR',
        }, {
            arg: './report/cov/mocha',
        }],
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Placement according to policy
        name: 'Pools Data Placement Test',
        lib_test: '/src/test/system_tests/test_files_spread',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Data Rebuild and Eviction
        name: 'Rebuild and Eviction Test',
        lib_test: '/src/test/system_tests//test_build_chunks',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Cloud Sync Test',
        lib_test: 'src/test/system_tests/test_cloud_sync.js',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test cloud sync functionality
        name: 'Bucket Access Test',
        lib_test: 'src/test/system_tests/test_bucket_access.js',
    }, {
        //Restore DB to defaults
        name: 'Restore DB Defaults',
        common: 'restore_db_defaults',
    }, {
        //Test Ceph S3
        name: 'Ceph S3 Test',
        lib_test: '/src/test/system_tests/test_ceph_s3.js',
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
