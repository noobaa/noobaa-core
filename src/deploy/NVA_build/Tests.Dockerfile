FROM noobaa-base as base

RUN yum install -y git && \
    yum clean all

# get ceph tests and run bootstrap
COPY ./src/test/system_tests/ceph_s3_tests_deploy.sh /noobaa/src/test/system_tests/
RUN /noobaa/src/test/system_tests/ceph_s3_tests_deploy.sh noobaa

COPY . ./

##############################################################
# Layers:
#   Title: Setting the GIT Commit hash in the package.json
#   Size: ~ 0 MB
#   Cache: rebuild when using the --build-arg flag
#
# Setting GIT_COMMIT for the base
# In order to set it we need to run build with 
# --build-arg GIT_COMMIT=$(git rev-parse HEAD)
##############################################################
ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi

FROM centos:7 as tester

ENV container docker
ENV TEST_CONTAINER true

##############################################################
# Layers:
#   Title: installing unitest pre requirments
#   Size: ~ 262 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
RUN echo 'PATH=$PATH:./node_modules/.bin' >> ~/.bashrc

# python-virtualenv python-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel -- these are required by ceph tests
RUN yum install -y -q ntpdate vim centos-release-scl && \
    yum install -y -q rh-mongodb36 && \
    yum install -y python-virtualenv python-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel && \
    yum clean all


# install kubectl
RUN stable_version=$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt) && \
    curl -LO https://storage.googleapis.com/kubernetes-release/release/${stable_version}/bin/linux/amd64/kubectl && \
    chmod +x ./kubectl && \
    mv ./kubectl /usr/local/bin/kubectl


##############################################################
# Layers:
#   Title: Node.js install with nvm
#   Size: ~ 61 MB
#   Cache: rebuild when Node.js version change in .nvmrc
#
# In order to build this we should run 
# docker build from the local repo 
##############################################################
COPY ./.nvmrc ./noobaa-core/.nvmrc
COPY ./src/deploy/NVA_build/install_nodejs.sh ./
RUN chmod +x ./install_nodejs.sh && \
    ./install_nodejs.sh $(cat ./noobaa-core/.nvmrc) && \
    npm config set unsafe-perm true

COPY --from=base /noobaa/src/test/system_tests/ /noobaa-core/src/test/system_tests/
RUN cd /noobaa-core/src/test/system_tests/s3-tests/ && \
    ./bootstrap && \
    touch ./s3tests/tests/__init__.py

COPY --from=base /noobaa /noobaa-core
WORKDIR /noobaa-core/

ENV SPAWN_WRAP_SHIM_ROOT /data
# set group as root and copy permissions for tests dir 
RUN chgrp -R 0 /noobaa-core/ && \
    chmod -R g=u /noobaa-core/ && \
    mkdir /data && \
    chgrp -R 0 /data && \
    chmod -R g=u /data 

##############################################################
# Layers:
#   Title: Setting some test env variables
#   Size: ~ 1 MB
#   Cache: rebuild when using the --build-arg flag
#
# Setting cloud cradentials for the tests
# In order to set those we need to run build with 
# --build-arg <arg_name>="<value>"
##############################################################

ARG aws_access_key_arg 
ARG aws_secret_access_key_arg
ARG azure_storage_arg
ARG test_name_arg
RUN mkdir -p /data/ && \
    echo 'ENDPOINT_BLOB_ENABLED=true' >> /data/.env && \
    echo 'DEV_MODE=true' >> /data/.env && \
    echo "TEST_RUN_NAME=$test_name_arg" >> /data/.env && \
    echo "AWS_ACCESS_KEY_ID=$aws_access_key_arg" >> /data/.env && \
    echo "AWS_SECRET_ACCESS_KEY=$aws_secret_access_key_arg" >> /data/.env && \
    echo "AZURE_STORAGE_CONNECTION_STRING=$azure_storage_arg" >> /data/.env 

USER 10001:0
CMD ["./src/test/unit_tests/run_npm_test_on_test_container.sh"]
