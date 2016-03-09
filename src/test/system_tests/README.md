# noobaa-core deployment tests
===========
### Core Tests Table of Contents:
* [Introduction](#introduction) - introduction
* [test_upgrade_ec2](#test_upgrade_ec2) - Test Upgrade Flow on EC2
* [test_upgrade_gcloud](#test_upgrade_gcloud) - Test Upgrade Flow on GCloud
* [test_files_ul](#test_small_files_ul) - Test UL of small files


* ### introduction
  The NooBaa deployment tests purpose is the verify various flows regarding initial deployment, NVA creation,
  upgrade etc.
  They can be combined with other more core functional tests to verify behavior after such flows.

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
