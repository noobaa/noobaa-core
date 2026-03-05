# This Dockerfile contains the image specification of the Hadoop S3A NC tester
# It is based on the maven image, and it clones the hadoop repository and pre-downloads the dependencies of the hadoop-aws module.
# This Dockerfile images will be stored in Quay.io under quay.io/noobaa/s3a-tester and used in the CI pipeline of the S3A NC tester.
FROM maven:3.9.6-eclipse-temurin-11

# Install git to pull the source
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Clone only the specific tag (shallow clone to save space/time)
RUN git clone --depth 1 --branch rel/release-3.3.6 https://github.com/apache/hadoop.git .

# 2. Pre-download the "Big" AWS JAR and S3A dependencies
# This layer is cached unless you change this command
RUN mvn dependency:go-offline -pl :hadoop-aws -am

# Default to the AWS tool directory
WORKDIR /app/hadoop-tools/hadoop-aws
CMD ["/bin/bash"]
