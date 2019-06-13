# noobaa-core deployment tests
===========
### Core Tests Table of Contents:
* [Introduction](#introduction) - introduction
* [Library Test](#library_test) - Creating a Library Test for the Framework
* [test_upgrade_gcloud](#test_upgrade_gcloud) - Test Upgrade Flow on GCloud
* [test_files_ul](#test_small_files_ul) - Test UL of small files
* [Sample Test](#sample_test) - Sample system test for a template


* ### introduction
  The NooBaa deployment tests purpose is the verify various flows regarding initial deployment, NVA creation,
  upgrade etc.
  They can be combined with other more core functional tests to verify behavior after such flows.

* ### library_test
  The testing framework can run tests by requiring them and running them instead of invoking a shell with node.
  In order to use this option, the test must export run_test(). See Sample test

* ### test_upgrade_gcloud
  Same as test_upgrade_ec2, but for gcloud.

* ### test_files_ul

* ### sample_test

```
"use strict";

var api = require('../../api');
var dotenv = require('../../util/dotenv');
dotenv.load();

var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

function run_test() {
    // Starting the test chain
        //Test Logic
        //...
        .then((res) => {
            rpc.disconnect_all();
            return P.resolve("Test Passed! Everything Seems To Be Fine...");
        })
        .catch(err => {
            console.error('test_bucket_placement FAILED: ', err.stack || err);
            rpc.disconnect_all();
            throw new Error('test_bucket_placement FAILED: ', err);
        })
}

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .fail(function(err) {
            process.exit(1);
        });
}

if (require.main === module) {
    main();
}

```
