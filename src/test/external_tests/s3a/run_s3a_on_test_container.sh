#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e

# ====================================================================================
# Set the environment variables
export email='admin@noobaa.io'
export password=123456789

export PORT=8080
export SSL_PORT=5443
export ENDPOINT_PORT=6001
export ENDPOINT_SSL_PORT=6443
export NOOBAA_MGMT_SERVICE_HOST=localhost
export NOOBAA_MGMT_SERVICE_PORT=${SSL_PORT}
export NOOBAA_MGMT_SERVICE_PROTO=wss
export S3_SERVICE_HOST=localhost

export CREATE_SYS_NAME=noobaa
export CREATE_SYS_EMAIL=${email}
export CREATE_SYS_PASSWD=${password}
export JWT_SECRET=123456789
export NOOBAA_ROOT_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export LOCAL_MD_SERVER=true

#The default max connections for postgres is 100. limit max clients to 10 per pool (per process). 
export CONFIG_JS_POSTGRES_MD_MAX_CLIENTS=10
export CONFIG_JS_POSTGRES_DEFAULT_MAX_CLIENTS=10

export POSTGRES_HOST=${POSTGRES_HOST:-localhost}
export MGMT_ADDR=wss://${NOOBAA_MGMT_SERVICE_HOST:-localhost}:${NOOBAA_MGMT_SERVICE_PORT:-5443}
export BG_ADDR=wss://localhost:5445
export HOSTED_AGENTS_ADDR=wss://localhost:5446
export S3A_TEST_LOGS_DIR=/logs/s3a-test-logs

# ====================================================================================

# Create the logs directory
mkdir -p ${S3A_TEST_LOGS_DIR}

# Deploy standalone NooBaa on the test container
./src/deploy/NVA_build/standalone_deploy.sh

# ====================================================================================

cd /root/node_modules/noobaa-core/

# Configure the S3A test - create account and bucket
node ./src/test/external_tests/s3a/configure_s3a.js

# ====================================================================================
# Install Maven and clone Hadoop repository
echo "Installing Maven and dependencies..."
yum install -y maven git java-11-openjdk-devel || dnf install -y maven git java-11-openjdk-devel

# Set JAVA_HOME
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk
export PATH=$JAVA_HOME/bin:$PATH

echo "Cloning Hadoop repository..."
HADOOP_VERSION="3.4.2"
HADOOP_DIR="/root/hadoop"
HADOOP_AWS_DIR="${HADOOP_DIR}/hadoop-tools/hadoop-aws"

if [ ! -d "${HADOOP_DIR}" ]; then
    cd /root
    git clone --depth 1 --branch rel/release-${HADOOP_VERSION} https://github.com/apache/hadoop
fi

# ====================================================================================
# Create auth-keys.xml configuration file
echo "Creating Hadoop S3A test configuration..."
cd ${HADOOP_AWS_DIR}

mkdir -p src/test/resources

cat > src/test/resources/auth-keys.xml <<EOF
<configuration>
  <property>
    <name>test.fs.s3a.name</name>
    <value>s3a://hadoop/</value>
  </property>
  <property>
    <name>fs.contract.test.fs.s3a</name>
    <value>\${test.fs.s3a.name}</value>
  </property>

  <property>
    <name>fs.s3a.endpoint</name>
    <value>http://localhost:${ENDPOINT_PORT}</value>
  </property>
  <property>
    <name>fs.s3a.endpoint.region</name>
    <value>us-east-1</value>
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
    <name>test.fs.s3a.create.create.acl.enabled</name>
    <value>false</value>
  </property>

  <property>
    <name>fs.s3.awsAccessKeyId</name>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3.awsSecretAccessKey</name>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>
  <property>
    <name>fs.s3n.awsAccessKeyId</name>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3n.awsSecretAccessKey</name>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>
  <property>
    <name>fs.s3a.access.key</name>
    <description>AWS access key ID. Omit for Role-based authentication.</description>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3a.secret.key</name>
    <description>AWS secret key. Omit for Role-based authentication.</description>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>

</configuration>
EOF

# ====================================================================================
# Run the Hadoop S3A tests
echo "Running Hadoop S3A tests..."
set +e  # Don't exit on test failures, we want to collect results

mvn clean verify -Dtest=TestS3A* -Dit.test=ITestS3A* 2>&1 | tee ${S3A_TEST_LOGS_DIR}/s3a-tests.log

# Capture the exit code
TEST_EXIT_CODE=$?

# ====================================================================================
# Generate summary
echo "Generating test summary..."
echo "========================================" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log
echo "Test Summary:" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log
grep "Tests run" ${S3A_TEST_LOGS_DIR}/s3a-tests.log | tail -1 | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log
echo "========================================" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log

echo "Test failures:" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log
grep "FAILURE" ${S3A_TEST_LOGS_DIR}/s3a-tests.log || echo "No FAILURE found in logs" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log
echo "========================================" | tee -a ${S3A_TEST_LOGS_DIR}/s3a-tests.log

# Exit with the test exit code
exit ${TEST_EXIT_CODE}
