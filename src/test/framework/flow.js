var steps = [{
    //Upgrade to new version
    name: 'Upgrading to new version',
    action: 'node src/test/system_tests/sanity_build_test.js',
    params: [{
        arg: '--upgrade_pack',
    }, {
        input_arg: 'upgrade_pack',
    }, {
        arg: '--target_ip',
    }, {
        arg: '127.0.0.1',
    }],
    blocking: true,
}, {
    //Run unit tests
    name: 'Unit Tests',
    action: 'gulp mocha',
}, {
    //Restore DB to defaults
    name: 'Restore DB Defaults',
    common: 'restore_db_defaults',
}, {
    //Test Data Placement according to policy
    name: 'Pools Data Placement Test',
    action: 'node src/test/system_tests/test_files_spread.js',
}, {
    //Restore DB to defaults
    name: 'Restore DB Defaults',
    common: 'restore_db_defaults',
}, {
    //Test Data Rebuild and Eviction
    name: 'Rebuild and Eviction Test',
    action: 'node src/test/system_tests/rebuild.js',
}, {
    //Restore DB to defaults
    name: 'Restore DB Defaults',
    common: 'restore_db_defaults',
}];

module.exports = steps;

/*Example Step:
{
  name: 'Some Name',
  action: 'node src/some_file.js' OR common 'function name'
  params: if exists, array of args
      [
        arg: 'value',
        input_arg: argument name of arg which was sent to the runner
      ]
  blocking: if true, will stop execution on failure of this step
}
*/
