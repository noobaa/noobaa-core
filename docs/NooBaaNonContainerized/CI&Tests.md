# NooBaa Non Containerized - CI & Tests

1. [Introduction](#introduction)
2. [CI](#ci)
    1. [Nightly RPM Builds](#nightly-rpm-builds)
    2. [Manual RPM Build](#manual-rpm-build)
3. [Unit and Integration Tests](#unit-and-integration-tests)
    1. [NC Tests](#nc-tests)
        1. [Running NC Tests](#running-nc-tests)
        2. [nc_index.js File](#nc_indexjs-file)
        3. [nc_coretest File](#nc_coretestjs-file)
    2. [NSFS Tests](#nsfs-tests) 
        1. [Running NSFS Tests](#running-nsfs-tests)
        2. [NSFS Tests General Information](#general-information)
        3. [NSFS Tests Files List](#nsfs-tests-files-list)
4. [Developer Manual Testing](#developer-manual-testing)
5. [Writing New Tests](#writing-new-tests)


## Introduction

NooBaa employs a Continuous Integration (CI) process to ensure the reliability and quality of its software. 
NooBaa Tests cover various aspects of functionality and integration. 
This proactive approach to testing enables NooBaa to deliver stable and efficient solutions for its users.

## CI

### Nightly RPM builds

Nightly NooBaa RPM builds are being built during the following github actions runs - 
1. [Nightly Master RPM build action](../../.github/workflows/nightly-rpm-master-build.yaml)
2. [Nightly 5.15 RPM build action](../../.github/workflows/nightly-rpm-stage-5.15.yaml)

The result of the nightly builds are 8 builds based on the following properties - 
1. Branch: `Master`, Architecture: `x86`, OS: `CentOS 8`.
2. Branch: `Master`, Architecture: `x86`, OS: `CentOS 9`. 
3. Branch: `Master`, Architecture: `ppc64le`, OS: `CentOS 8`. 
4. Branch: `Master`, Architecture: `ppc64le`, OS: `CentOS 9`. 
5. Branch: `5.15`, Architecture: `x86`, OS: `CentOS 8`. 
6. Branch: `5.15`, Architecture: `x86`, OS: `CentOS 9`. 
7. Branch: `5.15`, Architecture: `ppc64le`, OS: `CentOS 8`. 
8. Branch: `5.15`, Architecture: `ppc64le`, OS: `CentOS 9`. 

#### RPMs Bucket
All 8 RPM builds will be uploaded nightly to AWS bucket called `s3://noobaa-core-rpms` and to the action execution artifacts.


### Manual RPM build
One can run a manual RPM build using [Manual Build RPM Github Action](../../.github/workflows/manual-build-rpm.yaml), NooBaa RPM manual build properties can be set by the github action executor.
The resulted RPM file will be attached to the action run artifacts.  

The following are the properties that a user can choose -
- `OS` - CentOS 8/9.
- `Architecture` - x86/ppc64le.
- `Branch` - [Every branch available in noobaa-core github repoistory](https://github.com/noobaa/noobaa-core/branches).
- `Tag` - Add a tag the manual build.




## Unit and Integration Tests

### NC Tests

#### General Information
* NC tests referring to test files testing the NSFS feature and more, in regard to non containerized deployment.

* Root permissions - NC tests that execute FS access check, require root permissions in order to replace the uid and gid by the requesting account’s NSFS configuration.

##### Running NC tests - 
Run `NC mocha tests` with root permissions - 
* Run all `NC mocha` tests **in a container** - 
    * Command: `sudo make run-nc-tests`.   
    * Description: The above command runs all NC tests mentioned in nc_index.js in a container.  

* Run `NC mocha` tests **locally** -  
  **Warning:** Running tests locally will do changes to your file system.
    * Run **all** NC mocha tests locally -  
        Command: `sudo NC_CORETEST=true node node_modules/mocha/bin/mocha src/test/utils/index/nc_index.js`.  

    * Run **a single** mocha test locally -  
        Command: `sudo NC_CORETEST=true node node_modules/mocha/bin/mocha src/test/{test_type}/{test_name}.js`.   

* Run `NC jest tests` - 
    * Command: `sudo jest --testRegex=jest_tests/test_nc`. 
    * Description: This command runs all NC related jest tests locally.

#### NC mocha tests 
The following is a list of `NC mocha test` files -   
1. `test_nc_cli.js` - Tests NooBaa CLI.  
2. `test_nc_health` - Tests NooBaa Health CLI.  
3. `test_nsfs_glacier_backend.js` - Tests NooBaa Glacier Backend.  
4. `test_nc_with_a_couple_of_forks.js` - Tests the `bucket_namespace_cache` when running with a couple of forks. Please notice that it uses `nc_coretest` with setup that includes a couple of forks.
5. `test_nc_online_upgrade_s3_integrations.js` - Tests S3 operations during mocked config directory upgrade.

#### NC Jest test files
The following is a list of `NC jest tests` files -   
1. `test_nc_account_invalid_mkm_integration.test.js` - Tests NC invalid master key manager scenarios.  
2. `test_nc_master_keys.test.js` - Tests NC master key manager (store type = file).  
3. `test_nc_master_keys_exec.test.js` - Tests NC master key manager (store type = executable).  
4. `test_nc_bucket_cli.test.js` - Tests NooBaa CLI bucket commands.  
5. `test_nc_account_cli.test.js` - Tests NooBaa CLI account commands.  
6. `test_nc_anonymous_cli.test.js` - Tests NooBaa CLI anonymous account commands.  
7. `test_nc_nsfs_config_schema_validation.test.js` - Tests NC config.json schema validation.  
8. `test_nc_nsfs_bucket_schema_validation.test.js` - Tests NC bucket schema validation.  
9. `test_nc_nsfs_account_schema_validation.test.js` - Tests NC account schema validation.  
10. `test_nc_nsfs_new_buckets_path_validation.test.js` - Tests new_buckets_path RW access.  
11. `test_config_fs.test.js` - Tests ConfigFS methods.
12. `test_nsfs_concurrency.test.js` - Tests concurrent operations.
13. `test_versioning_concurrency.test.js` - Tests concurrent operations on versioned enabled bucket.
14. `test_config_dir_restructure_upgrade_script.test.js` - Tests of the config directory restructure upgrade script.
15. `test_config_dir_structure.test.js` - Tests of the configFS functions created for the new config directory structure.
16. `test_config_fs_backward_compatibility.test.js` - Tests of the backwards compatibility of configFS functions.
17. `test_nc_upgrade_manager.test.js` - Tests of the NC upgrade manager.
18. `test_cli_upgrade.test.js` - Tests of the upgrade CLI commands.
19. `test_nc_online_upgrade_cli_integrations.test.js` - Tests CLI commands during mocked config directory upgrade.
20. `test_nc_connection_cli.test.js` - Tests NooBaa CLI connection commands.
21. `test_nc_lifecycle_posix_integration.test` - Tests NC lifecycle POSIX related configuration.
(Note: in this layer we do not test the validation related to lifecycle configuration and it is done in `test_lifecycle.js` - which currently is running only in containerized deployment, but it is mutual code)

#### nc_index.js File
* The `nc_index.js` is a file that runs several NC and NSFS mocha related tests.  
* Before running NC tests, `nc_coretest` setup will be called, and after the run of all tests, `nc_coretest` teardown will be executed.

#### nc_coretest.js File
* The `nc_coretest.js` is a file that runs setup and teardown before/after NC integration tests run.  
* Moreover, `nc_coretest.js` includes mapping between RPC API calls to NooBaa CLI calls in order to be able to run same integration tests on both containerized and non containerized deployments.  
* Use `NC_CORETEST=true` environment variable when running NC NSFS integration test (test_nsfs_integration.js).

##### Differences Between Containerized and Non Containerized
* `new_buckets_path` -
    1. On NC environment - new_buckets_path is a full absolute path.
    2. On Containerized environment - new_buckets_path is the directory that will be concatenated to the namespace resource path.

* `Multiple bucket exports of a single file system directory` - 
    1. On NC environment - A user is `allowed` to export the same underlying file system into multiple bucket entries.
    2. On Containerized environment - A user is `not allowed` to export the same underlying file system into multiple bucket entries.

    3. For more info about exported buckets, see -  
        * [S3 Bucket VS CLI Exported Bucket](./AccountsAndBuckets.md#s3-bucket-vs-cli-exported-bucket).  
        * [Bucket Management](./NooBaaCLI.md#managing-buckets).

* `system owner / admin`
    1. On NC environment - Do not exist.
    2. On Containerized environment - Exist.

### NSFS Tests

#### General Information

* NSFS tests referring to test files testing the NSFS feature, regardless of the deployment type (containerized / non containerized). These tests usually run tests related to NamespaceFS.  

* Root permissions - NSFS feature tests that execute FS access check, require root permissions inorder to replace the uid and gid by the requesting account’s nsfs configuration.

##### Running NSFS tests -  
Run `NSFS tests` with root permissions -   

* Run all `NSFS mocha` tests **in a container** - 
    * Command: `sudo make root-perm-test`.   
    * Description: The above command runs all NSFS tests mentioned in sudo_index.js in a container.  

* Run `NSFS mocha` tests **locally** -  
  **Warning:** Running tests locally will do changes to your file system.
    * Run **all** NSFS mocha tests locally -  
        Command: `sudo node node_modules/mocha/bin/mocha src/test/utils/index/sudo_index.js`.  

    * Run **a single** mocha test locally -  
        Command: `sudo node node_modules/mocha/bin/mocha src/test/{test_type}/{test_name}.js`.   


#### NSFS Tests Files List
With NamespaceFS now supporting additional features, more tests have been added.  
Consequently, there are now distinct test files, each with a unique scope - 

1. `test_namespace_fs.js` - Tests NamespaceFS API.
2. `test_ns_list_objects.js` - Tests NamespaceFS list objects API.
3. `test_nsfs_access.js` - Tests uid and gid accessibility of Napi native code.  
4. `test_nsfs_integration.js` - Tests s3 flows on top of NSFS namespace resources.
5. `test_nb_native_fs.js` - Tests Napi native code.
6. `test_nb_native_gpfs.js` - Tests Napi native code on top of GPFS.
7. `test_nsfs_versioning.js` - Tests NamespaceFS versioning API.
8. `test_nsfs_versioning_gpfs.js` - Tests NamespaceFS versioning API on top of gpfs.
9. `test_bucketspace_versioning.js` - Tests s3 versioning flows on top of NSFS namespace resources.
10. `test_namespace_fs_mpu.js` - Tests different types of multipart upload on NSFS.

## Developer Manual Testing

Most NC manual developer tests do not require RPM build and install, therefore running the initial NC deployment script locally for deploying NooBaa NC endpoint should be adequate.  
**Warning:** Running manual tests locally will do changes to your file system.

1. Running nsfs.js script for deploying NooBaa NC endpoint - 
    ```bash
    sudo node src/cmd/nsfs.js --debug=5
    ```

2. Running S3 requests direct to the NooBaa endpoint, for example using AWS S3 CLI -
    ```bash
    #  create and alias
    alias s3='AWS_ACCESS_KEY_ID=<access_key> AWS_SECRET_ACCESS_KEY=<secret_key> aws --endpoint-url=https://127.0.0.1:6443 --no-verify-ssl s3'

    # Run S3 commands
    s3 ls
    s3 mb s3://bucket1
    echo "content of object1" > object1.txt
    s3 cp object1.txt s3://bucket1
    ```

## Writing New Tests

Ensure that new tests are written using the Jest framework to leverage Jest's built-in tools for mocking, fast running, etc, making it more efficient and maintainable.
