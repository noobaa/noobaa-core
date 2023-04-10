# Ceph S3 Tests Guide
## Introduction
* Ceph S3 tests are unofficial AWS S3 compatibility tests written in Python (for more information see: [ceph/s3-test](https://github.com/ceph/s3-tests) repository on GitHub) that we use in our CI.
* This guide contains:
     1) General Settings For Ceph S3 Tests
     2) Run All Ceph S3 Tests
     3) Run a Single Ceph S3 Test
     4) Debug a Single Ceph S3 Test
     5) Examples
* This guide describes developer steps to run Ceph S3 on a noobaa system on minikube.

## General Settings For Ceph S3 Tests
We assume that it is not your first deployment of noobaa system, and you already succeeded with it (If not, please see the guide [Deploy Noobaa On Minikube](../deply_noobaa_on_minikube.md)).
We will run the commands in the terminal, you may work with at least two tabs:
1) For noobaa-core repository
2) For noobaa-operator repository

More tabs will be used to view the endpoint logs, connect to the tester pod, etc.
In each step, it is mentioned what tab you should use.

### 1) Before Building The Images (Noobaa-Core Tab)
We will use minikube to run the tests. It is recommended to build all images on the minikube docker daemon. Configure your docker client to use minikube's docker run:
```bash
eval $(minikube docker-env)
```

### 2) Build Operator (Noobaa-Operator Tab)
In order to build the CLI and the operator image run the following:
```bash
. ./devenv.sh
make all
```
Note: the file `devenv.sh` contains the command `eval $(minikube docker-env)`. We run the command `eval $(minikube docker-env)` prior to an image build (whether from noobaa core repository or noobaa operator repository). 

This will build the following:
* noobaa-operator image with tag `noobaa/noobaa-operator:<major.minor.patch>` (for example: `noobaa/noobaa-operator:5.13.0`). this tag is used by default when installing with the CLI.
* noobaa CLI. The `devenv.sh` script is setting an alias `nb` to run the local build of the CLI.

### 3) Build Core And Tester Images (Noobaa-Core Tab)
Run the following to build noobaa core image with the desired tag to build the tester image:
```bash
make tester TESTER_TAG=noobaa-tester:s3-tests
docker tag noobaa:latest noobaa-core:s3-tests
```

### 4) Deploy Noobaa (Noobaa-Operator Tab)
```bash
nb install --mini --noobaa-image='noobaa-core:s3-tests'
```
_Note: We have the alias to `nb` from the step 'Build Operator'._

The installation should take 5-10 minutes.
Once noobaa is installed please notice that the phase is Ready, you will see it in the CLI logs:

✅ System Phase is "Ready".

You can see something similar to this when getting the pods:
```
> kubectl get pods
NAME                                               READY   STATUS    RESTARTS   AGE
noobaa-core-0                                      1/1     Running   0          51m
noobaa-db-pg-0                                     1/1     Running   0          51m
noobaa-default-backing-store-noobaa-pod-a586c55b   1/1     Running   0          47m
noobaa-endpoint-6cf5cccfc6-rmdrd                   1/1     Running   0          47m
noobaa-operator-5c959d5564-qzgqb                   1/1     Running   0          51m
```

### 5) Wait For Default Backingstore to Be Ready (Noobaa-Operator Tab)
We will use the default backingstore pod to run the tests, we need it to be in phase Ready, run:
```bash
kubectl wait --for=condition=available backingstore/noobaa-default-backing-store --timeout=6m
```

## Run All Ceph S3 Tests

### 1) Requisitions:
Following the 'General Settings For Ceph S3 Tests' steps.

### 2) Deploy The Tests Job (Noobaa-Core Tab):
```bash
kubectl apply -f src/test/system_tests/ceph_s3_tests/test_ceph_s3_job.yml
```
### 3) View Logs of The Tester Job (New Tab):
```bash
kubectl logs job/noobaa-tests-s3 -f
```

We run all the tests except the tests that appear in the lists `src/test/system_tests/ceph_s3_tests/s3-tests-lists` if you would like to add or remove a test you can edit those files (and then repeat the steps starting from 'Build Core And Tester Images (Noobaa-Core)' above).

## Run a Single Ceph S3 Test

### 1) Requisitions:
Following the 'General Settings For Ceph S3 Tests' steps.

### 2) Increasing Debug Level (Noobaa-Operator)
Before running a test, you can increase the debug level with noobaa CLI.
```bash
nb system set-debug-level 1
```
A good level to start with is 1, the higher you go the more verbose and noisy the logs will become (it is recommended using 3 level at the most for those tests).

Tip: If there is an existing printing in higher level than 1 and you only want to see it (or you wish to add a certain printing) change the debug level of the printing in the code to 0 (repeat the steps starting from 'Build Core And Tester Images (Noobaa-Core)' above), for example:

```diff
-        dbg.log2('message');
+        dbg.log0('message');
```


### 3) Deploy The Tester Deployment (Noobaa-Core Tab)
Use the `test_ceph_s3_deployment.yml` file to install the tester pod. 
Applying this file will result in the deployment of the noobaa tester image in a pod so a developer will be able to run and configure the test from inside of the pod.
```bash
kubectl apply -f src/test/system_tests/ceph_s3_tests/test_ceph_s3_deployment.yml
```

### 4) Setup Test Config (Inside The Tester Pod)
Once the tester pod is up, we can go into it and prepare the environment to run the tests.
both `kubectl` and `oc` can be used:
```bash
# if you have kubectl 
kubectl exec -it [noobaa-tester pod] -- bash
# or with oc
oc rsh [noobaa-tester pod] bash
```

In the tester pod, go to noobaa working directory:
```bash
cd /root/node_modules/noobaa-core/
```

Run the script that will create the necessary accounts in noobaa and update the Ceph S3 tests config file accordingly:
```bash
node ./src/test/system_tests/ceph_s3_tests/test_ceph_s3_config_setup.js
```

Note: If you want to ignore PythonDeprecationWarnings use (which will then ignore all Python warnings, so keep that in mind):
```bash
export PYTHONWARNINGS="ignore"
```

### 5) Run a Test (Inside The Tester Pod)
To run a test, from noobaa working directory:
```bash
S3TEST_CONF=src/test/system_tests/ceph_s3_tests/test_ceph_s3_config.conf ./src/test/system_tests/ceph_s3_tests/s3-tests/virtualenv/bin/nosetests <test_name>
```
This should run the test on the noobaa deployment we've set up.

#### Test Name
You can find a list of tests in the doc inside the file `ceph_s3_tests_list_single_test.txt`. Please notice that the test name has a certain structure <directory_name> are separated with `.` and the function to run (usually with a prefix `test_`) appears after the `:` sign.
## Debug a Single Test (Inside The Tester Pod)

### 1) Requisitions:
Following the 'Run a Single Ceph S3 Test' steps.
### 2) View The Test Content 
You can view the test by going to the test file and searching for the test function. e.g. if you are working on test `s3tests_boto3.functional.test_s3:test_set_bucket_tagging` then you should `vim ./src/test/system_tests/ceph_s3_tests/s3-tests/s3tests_boto3/functional/test_s3.py` and search for the function `test_set_bucket_tagging`.

The best place to start investigating is noobaa endpoint pod logs. if you are running with debug level that is higher than 1, you should see log messages of the S3 requests with the prefix `S3 REQUEST`. S3 replies will be with the prefix `HTTP REPLY`.

### 3) Change a Test
Sometimes you would like to change a test: add printing of variables, skip an assertion as needed, or you suspect that it has a faulty and you would like to change the code.

Since the file `./src/test/system_tests/ceph_s3_tests/s3-tests/s3tests_boto3/functional/test_s3.py` is a read-only file, decide on one of the options:

#### A. Permanent change - this change will be saved in a repo, it is for continues investigating. 
1) Fork and clone the repository [ceph/s3-test](https://github.com/ceph/s3-tests).
2) Create a new branch from the hash number that was set in the file `./src/test/system_tests/ceph_s3_tests/test_ceph_s3_deploy.sh`.
3) Change the code, commit, and push to the remote branch.
4) Inside the file `test_ceph_s3_deploy.sh` (mentioned above) Change the values of `CEPH_LINK` to your remote repository and the `CEPH_TESTS_VERSION` to the newest commit in your repository.
5) Build the tester image again, deploy noobaa, and run the test (repeat the steps starting from 'Build Core And Tester Images (Noobaa-Core)' above).

#### B. Temporary change - this change will be saved in the file inside the container, useful when you need a small change.
1) Find container ID: `minikube ssh docker container ls | grep test`
2) Enter container as the root user: `minikube ssh "docker container exec -it -u 0 <Container ID> /bin/bash"`
3) Change file permissions: `chmod 777 ./src/test/system_tests/ceph_s3_tests/s3-tests/s3tests_boto3/functional/test_s3.py`

## Examples

## Running All the Tests

### Requisitions:
Following the 'Run All Ceph S3 Tests' steps.

### 1) All Running Tested Passed
a snippet from the last part of running all the tests.
You can see how many tests run and a status for each test.
```
...
Test Passed: s3tests_boto3.functional.test_sts.test_assume_role_with_web_identity_resource_tag_copy_obj
Test Passed: s3tests_boto3.functional.test_sts.test_assume_role_with_web_identity_role_resource_tag
Test Passed: s3tests_boto3.functional.test_utils.test_generate
Finished Running Ceph S3 Tests
CEPH TEST SUMMARY: Suite contains 812, ran 387 tests, Passed: 387, Skipped: 0, Failed: 0
```
## Running a Single Test

### Requisitions:
Following the 'Run a Single Ceph S3 Test' steps.

### 1) Test Pass
For example: `s3tests_boto3.functional.test_s3:test_basic_key_count`
```
bash-4.4$ S3TEST_CONF=src/test/system_tests/ceph_s3_tests/test_ceph_s3_config.conf ./src/test/system_tests/ceph_s3_tests/s3-tests/virtualenv/bin/nosetests s3tests_boto3.functional.test_s3:test_basic_key_count
.
----------------------------------------------------------------------
Ran 1 test in 4.914s

OK
```
### 2) Test Fail
For example: `s3tests_boto3.functional.test_s3:test_account_usage`

```
bash-4.4$ S3TEST_CONF=src/test/system_tests/ceph_s3_tests/test_ceph_s3_config.conf ./src/test/system_tests/ceph_s3_tests/s3-tests/virtualenv/bin/nosetests s3tests_boto3.functional.test_s3:test_account_usage
E
======================================================================
ERROR: s3tests_boto3.functional.test_s3.test_account_usage
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/root/node_modules/noobaa-core/src/test/system_tests/ceph_s3_tests/s3-tests/virtualenv/lib/python3.6/site-packages/nose/case.py", line 198, in runTest
    self.test(*self.arg)
  File "/root/node_modules/noobaa-core/src/test/system_tests/ceph_s3_tests/s3-tests/s3tests_boto3/functional/test_s3.py", line 1325, in test_account_usage
    summary = parsed['Summary']
KeyError: 'Summary'
-------------------- >> begin captured logging << --------------------
...
<view the logs>
...
--------------------- >> end captured logging << ---------------------

----------------------------------------------------------------------
Ran 1 test in 0.391s

FAILED (errors=1)

```
### 3) Wrong Test Name
If you will use a test name that not written in the defined structure (as mentioned in 'Test Name' section) you will get a falsy OK.

For example: `s3tests_boto3.functional.test_s3.test_account_usage` instead of `s3tests_boto3.functional.test_s3:test_account_usage` (notice the use of the sign `:` before test).
```
bash-4.4$ S3TEST_CONF=src/test/system_tests/ceph_s3_tests/test_ceph_s3_config.conf ./src/test/system_tests/ceph_s3_tests/s3-tests/virtualenv/bin/nosetests s3tests_boto3.functional.test_s3.test_account_usage

----------------------------------------------------------------------
Ran 0 tests in 0.389s

OK
```
You can avoid it by using the name according to the structure or copy the test name from the file `ceph_s3_tests_list_single_test.txt`.
