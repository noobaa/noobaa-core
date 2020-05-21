FROM noobaa

USER 0:0

ENV container docker
ENV TEST_CONTAINER true

##############################################################
# Layers:
#   Title: installing tests pre-requirments
#   Size: ~ 344 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################

# python-virtualenv python-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel -- these are required by ceph tests
# RUN dnf install -y ntpdate vim && \
COPY ./src/deploy/NVA_build/set_mongo_repo.sh /tmp/
RUN chmod +x /tmp/set_mongo_repo.sh && \
    /bin/bash -xc "/tmp/set_mongo_repo.sh"

RUN dnf install -y -q --nogpgcheck vim \
    mongodb-org-3.6.3 \
    mongodb-org-server-3.6.3 \
    mongodb-org-shell-3.6.3 \
    mongodb-org-mongos-3.6.3 \
    mongodb-org-tools-3.6.3 \
    which python3-virtualenv python36-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel \
    git && \
    dnf clean all

##############################################################
# Layers:
#   Title: extract noobaa code 
#   Size: ~ 239 MB
#
##############################################################

RUN tar -xzf /tmp/noobaa-NVA.tar.gz
WORKDIR /noobaa-core/

##############################################################
# Layers:
#   Title: npm install to add dev dependencies (noobaa is build with npm install --prod) 
#   Size: ~ 33 MB
#
##############################################################
RUN npm install

RUN mkdir -p /noobaa-core/.nyc_output && \
    chmod 777 /noobaa-core/.nyc_output
# create dirs and fix permissions required by tests
RUN mkdir -p /noobaa-core/node_modules/.cache/nyc && \
    chmod 777 /noobaa-core/node_modules/.cache/nyc
RUN mkdir -p /noobaa-core/coverage && \
    chmod 777 /noobaa-core/coverage
RUN chmod -R 777 /noobaa-core/src/test

##############################################################
# Layers:
#   Title: deploy ceph tests
#   Size: ~ 83.9 MB
#
##############################################################


RUN /noobaa-core/src/test/system_tests/ceph_s3_tests_deploy.sh
RUN cd /noobaa-core/src/test/system_tests/s3-tests/ && \
    ./bootstrap
COPY .eslintrc.js /noobaa-core
COPY .eslintignore /noobaa-core

# Making mocha accessible 
RUN ln -s /noobaa-core/node_modules/mocha/bin/mocha /usr/local/bin

ENV SPAWN_WRAP_SHIM_ROOT /data
RUN mkdir -p /data && \
    chgrp -R 0 /data && \
    chmod -R g=u /data 

USER 10001:0
CMD ["./src/test/unit_tests/run_npm_test_on_test_container.sh"]
