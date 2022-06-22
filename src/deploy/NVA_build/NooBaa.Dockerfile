FROM noobaa-base as server_builder

RUN mkdir -p /noobaa_init_files && \
    cp -p ./build/Release/kube_pv_chown /noobaa_init_files

COPY . ./
ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi 

##############################################################
# Layers:
#   Title: Creating the noobaa tar
#   Size: ~ 153 MB
#   Cache: Rebuild when one of the files are changing
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
    build/Release/ \
    node_modules/ 

#####################################################################################################################################

##############################################################
#   Title: Start of the Server Image
#   Size: ~ 841 MB
#   Cache: Rebuild when any layer is changing
##############################################################

FROM quay.io/centos/centos:stream8

ENV container docker
ENV PORT 8080
ENV SSL_PORT 8443
ENV ENDPOINT_PORT 6001
ENV ENDPOINT_SSL_PORT 6443
ENV WEB_NODE_OPTIONS ''
ENV BG_NODE_OPTIONS ''
ENV HOSTED_AGENTS_NODE_OPTIONS ''
ENV ENDPOINT_NODE_OPTIONS ''

##############################################################
# Layers:
#   Title: Installing dependencies
#   Size: ~ 379 MB
#   Cache: Rebuild when we adding/removing requirments
##############################################################

RUN dnf install -y epel-release
RUN dnf install -y -q bash \
    lsof \
    procps \
    openssl \
    rsyslog \
    strace \
    wget \
    curl \
    nc \
    less \
    bash-completion \
    python3-setuptools \
    jemalloc \
    xz && \
    dnf clean all

RUN mkdir -p /usr/local/lib/python3.6/site-packages

##############################################################
# Layers:
#   Title: Getting the node 
#   Size: ~ 110 MB
#   Cache: Rebuild the .nvmrc is changing
##############################################################
COPY ./.nvmrc ./.nvmrc
COPY ./src/deploy/NVA_build/install_nodejs.sh ./
RUN chmod +x ./install_nodejs.sh && \
    ./install_nodejs.sh $(cat .nvmrc)

##############################################################
# Layers:
#   Title: Copying and giving premissions 
#   Size: ~ 1 MB
#   Cache: Rebuild when we need to add another copy
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

COPY --from=server_builder /kubectl /usr/local/bin/kubectl
COPY --from=server_builder ./noobaa_init_files/kube_pv_chown /noobaa_init_files
RUN mkdir -m 777 /root/node_modules && \
    chown root:root /noobaa_init_files/kube_pv_chown && \
    chmod 750 /noobaa_init_files/kube_pv_chown && \
    chmod u+s /noobaa_init_files/kube_pv_chown

##############################################################
# Layers:
#   Title: Copying the tar file from the server_builder
#   Size: ~ 153 MB
#   Cache: Rebuild when there is a new tar file.
##############################################################
COPY --from=server_builder /noobaa/noobaa-NVA.tar.gz /tmp/
RUN cd /root/node_modules && \
    tar -xzf /tmp/noobaa-NVA.tar.gz && \
    chgrp -R 0 /root/node_modules && \
    chmod -R 775 /root/node_modules 

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

# Needs to be added only after installing jemalloc in dependencies section (our env section is before) - otherwise it will fail
ENV LD_PRELOAD /usr/lib64/libjemalloc.so.2

###############
# EXEC SETUP #
###############
# Run as non root user that belongs to root 
USER 10001:0

# We are using CMD and not ENDPOINT so 
# we can override it when we use this image as agent. 
CMD ["/usr/bin/supervisord", "start"]
