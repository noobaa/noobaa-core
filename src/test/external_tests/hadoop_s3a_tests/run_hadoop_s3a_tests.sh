#!/usr/bin/env bash
set -euo pipefail

: "${S3A_ENDPOINT:?S3A_ENDPOINT must be set}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID must be set}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY must be set}"
: "${HADOOP_S3A_BRANCH:?HADOOP_S3A_BRANCH must be set}"
: "${HADOOP_S3A_BUCKET:?HADOOP_S3A_BUCKET must be set}"

apt-get update -y
apt-get install -y git
git clone --depth 1 --branch "${HADOOP_S3A_BRANCH}" https://github.com/apache/hadoop.git /tmp/hadoop
mkdir -p /tmp/hadoop/hadoop-tools/hadoop-aws/src/test/resources
cat <<EOF > /tmp/hadoop/hadoop-tools/hadoop-aws/src/test/resources/auth-keys.xml
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
</configuration>
EOF

cd /tmp/hadoop
mvn_cmd="mvn -pl hadoop-tools/hadoop-aws -DskipTests=false -DskipITs=false -Dit.test=ITestS3A* -Dtest=TestS3A* verify"
echo "Running: ${mvn_cmd}"
eval "${mvn_cmd}"
