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
RUN yum install -y -q ntpdate vim centos-release-scl && \
    yum install -y -q rh-mongodb36 && \
    yum install -y python-virtualenv python-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel && \
    yum install -y git && \
    yum clean all

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
#   Title: deploy ceph tests
#   Size: ~ 83.9 MB
#
##############################################################


RUN /noobaa-core/src/test/system_tests/ceph_s3_tests_deploy.sh
RUN cd /noobaa-core/src/test/system_tests/s3-tests/ && \
    ./bootstrap && \
    touch ./s3tests/tests/__init__.py
COPY .eslintrc.js /noobaa-core

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

ENV SPAWN_WRAP_SHIM_ROOT /data
RUN mkdir -p /data && \
    chgrp -R 0 /data && \
    chmod -R g=u /data 

USER 10001:0
CMD ["./src/test/unit_tests/run_npm_test_on_test_container.sh"]
