# This script objective is to run Ceph s3 tests
# We use it inside of K8S job, see noobaa-tests-s3-job
# since we use "|| true" this job will always end with "Completed" status

#!/bin/bash
set -x

CEPH_S3_DIRECTORY="src/test/external_tests/ceph_s3_tests"
CEPH_S3_TESTS_CONFIG="${CEPH_S3_DIRECTORY}/test_ceph_s3_config_setup.js"
CEPH_S3_RUN_TESTS="${CEPH_S3_DIRECTORY}/test_ceph_s3.js"

# choose test lists based on USE_S3_NAMESPACE_RESOURCE flag
# later we will add more test lists for other types of namespace resources
if [ "${USE_S3_NAMESPACE_RESOURCE}" = "true" ]; then
    S3_CEPH_TEST_BLACKLIST="${CEPH_S3_DIRECTORY}/s3-tests-lists/ns_aws_s3_tests_black_list.txt"
    S3_CEPH_TEST_PENDING_LIST="${CEPH_S3_DIRECTORY}/s3-tests-lists/ns_aws_s3_tests_pending_list.txt"
else
    S3_CEPH_TEST_BLACKLIST="${CEPH_S3_DIRECTORY}/s3-tests-lists/s3_tests_black_list.txt"
    S3_CEPH_TEST_PENDING_LIST="${CEPH_S3_DIRECTORY}/s3-tests-lists/s3_tests_pending_list.txt"
fi

NUMBER_OF_WORKERS=1

cd /root/node_modules/noobaa-core/
node ./${CEPH_S3_TESTS_CONFIG}
node ./${CEPH_S3_RUN_TESTS} --ignore_lists ${S3_CEPH_TEST_BLACKLIST},${S3_CEPH_TEST_PENDING_LIST} --concurrency ${NUMBER_OF_WORKERS}
