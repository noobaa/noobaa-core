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

RUN dnf group install -y -q "Development Tools" && \
    dnf install -y -q --nogpgcheck vim \
    mongodb-org-3.6.3 \
    mongodb-org-server-3.6.3 \
    mongodb-org-shell-3.6.3 \
    mongodb-org-mongos-3.6.3 \
    mongodb-org-tools-3.6.3 \
    # commenting out as we are not running ceph test (system_test_list) anywhere
    which python3-virtualenv python36-devel libevent-devel libffi-devel libxml2-devel libxslt-devel zlib-devel \ 
    git && \
    dnf clean all

WORKDIR /root/node_modules/noobaa-core/

##############################################################
# Layers:
#   Title: deploy ceph tests
#   Size: ~ 83.9 MB
#
##############################################################
# commenting out as we are not running ceph test (system_test_list) anywhere
RUN ./src/test/system_tests/ceph_s3_tests_deploy.sh $(pwd)
RUN cd ./src/test/system_tests/s3-tests/ && \
    ./bootstrap

##############################################################
# Layers:
#   Title: npm install to add dev dependencies (noobaa is build with npm install --prod) 
#   Size: ~ 33 MB
#
##############################################################
RUN npm install

COPY .eslintrc.js /root/node_modules/noobaa-core
COPY .eslintignore /root/node_modules/noobaa-core

# Making mocha accessible 
RUN ln -s /root/node_modules/noobaa-core/node_modules/mocha/bin/mocha.js /usr/local/bin

ENV SPAWN_WRAP_SHIM_ROOT /data
RUN mkdir -p /data && \
    chgrp -R 0 /data && \
    chmod -R g=u /data 

USER 10001:0
CMD ["./src/test/unit_tests/run_npm_test_on_test_container.sh"]
