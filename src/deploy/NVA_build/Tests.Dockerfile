FROM noobaa AS noobaa-tester

USER 0:0

ENV container=docker
ENV TEST_CONTAINER=true

##############################################################
# Layers:
#   Title: installing tests pre-requirments
#   Size: ~ 344 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################

RUN dnf config-manager --enable crb || true
RUN dnf clean all

RUN dnf group install -y -q "Development Tools" && \
    dnf install -y -q --nogpgcheck vim \
    which python3-virtualenv python3-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel \
    git  \
    tox && \
    dnf clean all

WORKDIR /root/node_modules/noobaa-core/

##############################################################
# Layers:
#   Title: deploy ceph tests
#   Size: ~ 83.9 MB
#
##############################################################
RUN ./src/test/external_tests/ceph_s3_tests/test_ceph_s3_deploy.sh $(pwd) 
# add group permissions to s3-tests directory (tox needs it in order to run)
RUN cd ./src/test/external_tests/ceph_s3_tests/ && \
    chgrp -R 0 s3-tests && \
    chmod -R g=u s3-tests

##############################################################
# Layers:
#   Title: npm install to add dev dependencies (noobaa is build with npm install --prod) 
#   Size: ~ 33 MB
#
##############################################################
RUN npm install

##############################################################
# Layers:
#   Title: Copy standalone deployment script to be used in the ceph tests
#   Size: ~ 1 KB
#
##############################################################
COPY ./src/deploy/NVA_build/standalone_deploy.sh ./src/deploy/NVA_build/standalone_deploy.sh
COPY ./src/test/external_tests/ceph_s3_tests/run_ceph_test_on_test_container.sh ./src/test/external_tests/ceph_s3_tests/run_ceph_test_on_test_container.sh
COPY ./src/deploy/NVA_build/standalone_deploy_nsfs.sh ./src/deploy/NVA_build/standalone_deploy_nsfs.sh
COPY ./src/test/external_tests/ceph_s3_tests/run_ceph_nsfs_test_on_test_container.sh ./src/test/external_tests/ceph_s3_tests/run_ceph_nsfs_test_on_test_container.sh
RUN chmod +x ./src/test/external_tests/ceph_s3_tests/run_ceph_nsfs_test_on_test_container.sh
COPY ./src/test/system_tests/run_sanity_test_on_test_container.sh ./src/test/system_tests/run_sanity_test_on_test_container.sh

COPY .eslintrc.js /root/node_modules/noobaa-core
COPY .eslintignore /root/node_modules/noobaa-core

# Making mocha accessible 
RUN ln -s /root/node_modules/noobaa-core/node_modules/mocha/bin/mocha.js /usr/local/bin

ENV SPAWN_WRAP_SHIM_ROOT=/data
RUN mkdir -p /data && \
    chgrp -R 0 /data && \
    chmod -R g=u /data 
RUN mkdir -p /.npm && \
    chgrp -R 0 /.npm && \
    chmod -R g=u /.npm 

USER 10001:0
CMD ["./src/test/framework/run_npm_test_on_test_container.sh"]
