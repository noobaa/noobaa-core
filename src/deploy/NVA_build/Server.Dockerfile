FROM noobaa/builder as server_builder

##############################################################
# Layers:
#   Title: installing dependencies (npm install)
#   Size: ~ 817 MB
#   Cache: rebuild when we package.json changes
##############################################################
COPY ./package*.json ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm install

##############################################################
# Layers:
#   Title: Building the native
#   Size: ~ 10 MB
#   Cache: rebuild the native code changes
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:native

##############################################################
# Layers:
#   Title: getting the node
#   Size: ~ 12.4 MB
#   Cache: rebuild the .nvmrc  is canging
##############################################################
COPY ./.nvmrc ./.nvmrc
RUN mkdir -p build/public/ && \
    NODEJS_VERSION=v$(cat ./.nvmrc) && \
    echo "$(date) =====> download node.js tarball ($NODEJS_VERSION) and nvm.sh (latest)" && \
    wget -P build/public/ https://nodejs.org/dist/${NODEJS_VERSION}/node-${NODEJS_VERSION}-linux-x64.tar.xz && \
    wget -P build/public/ https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh

##############################################################
# Layers:
#   Title: Building the frontend
#   Size: ~ 268 MB
#   Cache: rebuild the there is a change in one of 
#          the directories that we copy
##############################################################
RUN mkdir -p /noobaa_init_files && \
    cp -p ./build/Release/kube_pv_chown /noobaa_init_files

COPY ./frontend/package*.json ./frontend/
RUN cd frontend && \
    npm install
COPY ./frontend/gulpfile.js ./frontend/
COPY ./frontend/bower.json ./frontend/
RUN cd frontend && \
    npm run install-deps

COPY ./frontend/ ./frontend/
COPY ./images/ ./images/
COPY ./src/rpc/ ./src/rpc/
COPY ./src/api/ ./src/api/
COPY ./src/util/ ./src/util/
COPY ./config.js ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:fe

COPY . ./
ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi 

##############################################################
# Layers:
#   Title: creating the noobaa tar
#   Size: ~ 153 MB
#   Cache: rebuild when one of the files are changing
#
# In order to build this we should run 
# docker build from the local repo 
##############################################################
RUN tar \
    --transform='s:^:noobaa-core/:' \
    --exclude='src/native/aws-cpp-sdk' \
    --exclude='src/native/third_party' \
    -czf noobaa-NVA.tar.gz \
    LICENSE \
    package.json \
    platform_restrictions.json \
    config.js \
    .nvmrc \
    src/ \
    frontend/dist/ \
    build/public/ \
    build/Release/ \
    node_modules/ 

#####################################################################################################################################

##############################################################
#   Title: Start of the Server Image
#   Size: ~ 841 MB
#   Cache: Rebuild when any layer is changing
##############################################################

FROM centos:7

ENV container docker

##############################################################
# Layers:
#   Title: installing dependencies
#   Size: ~ 379 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
COPY ./src/deploy/rpm/set_mongo_repo.sh /tmp/
RUN chmod +x /tmp/set_mongo_repo.sh && \
    /bin/bash -xc "/tmp/set_mongo_repo.sh"
RUN yum install -y -q bash \
    bind-utils-32:9.9.4 \
    bind-32:9.9.4 \
    tcpdump-14:4.9.2 \
    cronie-1.4.11 \
    initscripts-9.49.46 \
    lsof-4.87 \
    net-tools-2.0 \
    openssh-server-7.4p1 \
    rng-tools-6.3.1 \
    rsyslog-8.24.0 \
    strace-4.12 \
    sudo-1.8.23 \
    wget-1.14 \
    dialog-1.2 \
    expect-5.45 \
    iperf3-3.1.7 \
    iptables-services-1.4.21 \
    curl-7.29.0 \
    ntp-4.2.6p5 \
    nc \
    vim \
    less \
    bash-completion \
    python-setuptools-0.9.8 \
    mongodb-org-3.6.3 \
    mongodb-org-server-3.6.3 \
    mongodb-org-shell-3.6.3 \
    mongodb-org-mongos-3.6.3 \
    mongodb-org-tools-3.6.3 && \
    yum clean all


##############################################################
# Layers:
#   Title: Node.js install with nvm
#   Size: ~ 58 MB
#   Cache: rebuild when Node.js version change in .nvmrc
#
# In order to build this we should run 
# docker build from the local repo 
##############################################################
COPY ./.nvmrc ./noobaa-core/.nvmrc
RUN export PATH=$PATH:/usr/local/bin && \
    cd /usr/src && \
    curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.6/install.sh | bash && \
    export NVM_DIR="/root/.nvm" && \
    source /root/.nvm/nvm.sh && \
    NODE_VER=$(cat /noobaa-core/.nvmrc) && \
    nvm install ${NODE_VER} && \
    nvm alias default $(nvm current) && \
    cd ~ && \
    ln -sf $(which node) /usr/local/bin/node && \
    ln -sf $(which npm) /usr/local/bin/npm

##############################################################
# Layers:
#   Title: Copying and giving premissions 
#   Size: ~ 1 MB
#   Cache: rebuild when we need to add another copy
#
# In order to build this we should run 
# docker build from the local repo 
##############################################################
RUN mkdir -p /data/ && \
    mkdir -p /log

COPY ./src/deploy/NVA_build/supervisord.orig ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/supervisord.orig /tmp/supervisord
COPY ./src/deploy/NVA_build/supervisorctl.bash_completion /etc/bash_completion.d/supervisorctl
COPY ./src/deploy/NVA_build/rsyslog.conf /etc/rsyslog.conf
COPY ./src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/
COPY ./src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa/
COPY ./src/deploy/NVA_build/noobaa_init.sh /noobaa_init_files/

COPY ./src/deploy/NVA_build/setup_platform.sh /usr/bin/setup_platform.sh
RUN /usr/bin/setup_platform.sh 

RUN chmod 775 /noobaa_init_files && \
    chgrp -R 0 /noobaa_init_files/ && \
    chmod -R g=u /noobaa_init_files/

COPY --from=server_builder ./noobaa_init_files/kube_pv_chown /noobaa_init_files
RUN mkdir -m 777 /root/node_modules && \
    chown root:root /noobaa_init_files/kube_pv_chown && \
    chmod 755 /noobaa_init_files/kube_pv_chown && \
    chmod u+s /noobaa_init_files/kube_pv_chown

##############################################################
# Layers:
#   Title: Copying the tar file from the server_builder
#   Size: ~ 153 MB
#   Cache: rebuild when there is a new tar file.
##############################################################
COPY --from=server_builder /noobaa/noobaa-NVA.tar.gz /tmp/

###############
# PORTS SETUP #
###############
EXPOSE 60100
EXPOSE 80
EXPOSE 443
EXPOSE 8080
EXPOSE 8443
EXPOSE 8444
EXPOSE 27000
EXPOSE 26050

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root 
USER 10001:0
CMD ["/usr/bin/supervisord", "start_container"]
