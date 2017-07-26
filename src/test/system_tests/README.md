# noobaa-core deployment tests
===========
### Core Tests Table of Contents:
* [Introduction](#introduction) - introduction
* [Library Test](#library_test) - Creating a Library Test for the Framework
* [test_upgrade_ec2](#test_upgrade_ec2) - Test Upgrade Flow on EC2
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

* ### test_upgrade_ec2
  This test comes to verify our upgrade flow. It's performs basic sanity after the upgrade just to make sure
  the upgrade itself was successful. This test runs on EC2 environment.
    1) It starts out with a base AMI already exist in EC2.
    2) Launching a new instance based on this AMI.
    3) Using the HTTP API to upgrade from a specific upgrade package.
    4) Perform basic sanity : list buckets, download agent distro package, u/l file, d/l file.

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
