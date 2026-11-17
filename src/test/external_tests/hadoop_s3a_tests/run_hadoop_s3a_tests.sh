#!/usr/bin/env bash
set -euo pipefail

: "${S3A_ENDPOINT:?S3A_ENDPOINT must be set}"

AWS_ACCESS_KEY_ID="hadoopS3aAccessKey01"
AWS_SECRET_ACCESS_KEY="hadoopS3aSecretKey0000000000000000000000"
HADOOP_S3A_BUCKET="s3a-test"

# As downloading the hadoop repository and pre-downloading the dependencies takes a long time, we do it in a separate step in the Dockerfile, and then we just run the tests in this script.
# This way, we can take advantage of Docker caching and avoid re-downloading the dependencies every time we want to run the tests.
# apt-get update -y
# apt-get install -y git
# git clone --depth 1 --branch "${HADOOP_S3A_BRANCH}" https://github.com/apache/hadoop.git /tmp/hadoop
# mkdir -p /tmp/hadoop/hadoop-tools/hadoop-aws/src/test/resources
cat <<EOF > src/test/resources/auth-keys.xml
<configuration>
  <property>
    <name>fs.s3a.endpoint</name>
    <value>${S3A_ENDPOINT}</value>
  </property>
  <property>
    <name>fs.s3a.connection.ssl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>fs.s3a.path.style.access</name>
    <value>true</value>
  </property>
  <property>
    <name>fs.s3a.aws.credentials.provider</name>
    <value>org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider</value>
  </property>
  <property>
    <name>fs.s3a.access.key</name>
    <value>${AWS_ACCESS_KEY_ID}</value>
  </property>
  <property>
    <name>fs.s3a.secret.key</name>
    <value>${AWS_SECRET_ACCESS_KEY}</value>
  </property>
  <property>
    <name>fs.s3a.region</name>
    <value>us-east-1</value>
  </property>
  <property>
    <name>test.fs.s3a.name</name>
    <value>s3a://${HADOOP_S3A_BUCKET}/</value>
  </property>
  <property>
    <name>test.fs.s3a.bucket</name>
    <value>${HADOOP_S3A_BUCKET}</value>
  </property>
  <property>
    <name>fs.s3a.bucket</name>
    <value>${HADOOP_S3A_BUCKET}</value>
  </property>
  <property>
    <name>fs.contract.test.fs.s3a</name>
    <value>s3a://${HADOOP_S3A_BUCKET}/</value>
  </property>
  <property>
    <name>test.fs.s3a.encryption.enabled</name>
    <value>false</value>
  </property>
   <property>
    <name>test.fs.s3a.create.storage.class.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.sts.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.create.acl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.performance.enabled</name>
    <value>false</value>
  </property>
  <!--
   If the store reports errors when trying to list/abort completed multipart uploads,
   expect failures in ITestUploadRecovery and ITestS3AContractMultipartUploader.
   The tests can be reconfigured to expect failure.
   Note how this can be set as a per-bucket option.
  -->
  <property>
    <name>fs.s3a.ext.test.multipart.commit.consumes.upload.id</name>
    <value>true</value>
  </property>
</configuration>
EOF

S3A_ITEST_BLACKLIST="/s3a-tests-lists/s3a_itests_black_list.txt"
ITEST_PATTERN="ITestS3A*"

if [ -f "$S3A_ITEST_BLACKLIST" ]; then
  while IFS= read -r name; do
    ITEST_PATTERN="${ITEST_PATTERN},!${name}"
  done < <(
    sed -e '/^[[:space:]]*#/d' \
        -e 's/^[[:space:]]*//' \
        -e 's/[[:space:]]*$//' \
        -e '/^$/d' \
        "$S3A_ITEST_BLACKLIST"
  )
fi

echo "Running: mvn -pl :hadoop-aws -am -DskipTests=false -DskipITs=false -Dit.test='${ITEST_PATTERN}' -Dtest=TestS3A* verify"

mvn -pl :hadoop-aws -am \
  -DskipTests=false \
  -DskipITs=false \
  "-Dit.test=${ITEST_PATTERN}" \
  -Dtest=TestS3A* \
  verify

# Maven may exit 0 despite Failsafe failures (BUILD SUCCESS).
FAILSAFE_SUMMARY="target/failsafe-reports/failsafe-summary.xml"
# Check if the Failsafe summary file exists
if [ ! -s "$FAILSAFE_SUMMARY" ]; then
  echo "Missing or empty Failsafe summary: ${FAILSAFE_SUMMARY}" >&2
  exit 1
fi

# Parse the Failsafe summary file
failures=$(grep -oE '<failures>[0-9]+</failures>' "$FAILSAFE_SUMMARY" | head -1 | grep -oE '[0-9]+' || true)
errors=$(grep -oE '<errors>[0-9]+</errors>' "$FAILSAFE_SUMMARY" | head -1 | grep -oE '[0-9]+' || true)
failsafe_result=$(grep -oE 'result="[^"]*"' "$FAILSAFE_SUMMARY" | head -1 | sed -E 's/^result="//;s/"$//' || true)

# Fail if failure/error counts cannot be parsed.
if [ -z "$failures" ] || [ -z "$errors" ]; then
  echo "Cannot parse Failsafe failure/error counts from ${FAILSAFE_SUMMARY}" >&2
  exit 1
fi
if [ -z "$failsafe_result" ]; then
  echo "Cannot parse Failsafe result attribute from ${FAILSAFE_SUMMARY}" >&2
  exit 1
fi
# Failsafe 3.0.0-M1 (Hadoop 3.3.6) writes result="null" on success (RunResult.getFailsafeCode()).
# Non-success codes include 255 (internal failure with zero counts) and 254 (no tests run).
case "$failsafe_result" in
  0|null) ;;
  *)
    echo "Failsafe integration tests failed: result=${failsafe_result} (expected 0 or null)" >&2
    echo "See ${FAILSAFE_SUMMARY} and target/failsafe-reports/*.txt" >&2
    exit 1
    ;;
esac
if [ "$failures" -gt 0 ] || [ "$errors" -gt 0 ]; then
  echo "Failsafe integration tests failed: failures=${failures} errors=${errors}" >&2
  echo "See ${FAILSAFE_SUMMARY} and target/failsafe-reports/*.txt" >&2
  exit 1
fi
