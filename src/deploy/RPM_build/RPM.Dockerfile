FROM noobaa-builder
ARG TARGETARCH

ARG CENTOS_VER=9
ARG BUILD_S3SELECT=0
ARG BUILD_S3SELECT_PARQUET=0

RUN mkdir -p /etc/logrotate.d/noobaa/
RUN mkdir -p /etc/noobaa.conf.d/

COPY ./src/agent ./src/agent
COPY ./src/api ./src/api
COPY ./src/cmd ./src/cmd
COPY ./src/deploy/spectrum_archive ./src/deploy/spectrum_archive
COPY ./src/deploy/noobaa_nsfs.service ./src/deploy/
COPY ./src/deploy/nsfs_env.env ./src/deploy/
COPY ./src/deploy/NVA_build/clone_submodule.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/clone_s3select_submodules.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/install_nodejs.sh ./src/deploy/NVA_build/
COPY ./src/endpoint ./src/endpoint
COPY ./src/hosted_agents ./src/hosted_agents
COPY ./src/native ./src/native/
COPY ./src/rpc ./src/rpc
COPY ./src/s3 ./src/s3
COPY ./src/sdk ./src/sdk
COPY ./src/server ./src/server
COPY ./src/tools ./src/tools
COPY ./src/upgrade ./src/upgrade
COPY ./src/util ./src/util
COPY ./config.js ./
COPY ./platform_restrictions.json ./
COPY ./Makefile ./
COPY ./package*.json ./
COPY ./binding.gyp .
COPY ./src/deploy/standalone/noobaa_rsyslog.conf ./src/deploy/standalone/noobaa_rsyslog.conf
COPY ./src/deploy/standalone/noobaa_syslog.conf ./src/deploy/standalone/noobaa_syslog.conf
COPY ./src/deploy/standalone/logrotate_noobaa.conf ./src/deploy/standalone/logrotate_noobaa.conf
COPY ./src/manage_nsfs ./src/manage_nsfs

WORKDIR /build

COPY ./src/deploy/RPM_build/* ./
COPY ./package.json ./
RUN bash ./preparesrc.sh /noobaa
RUN chmod +x ./packagerpm.sh

# These envs are used by the packagerpm.sh either directly or by
# performing subsitutions in the noobaa.spec file
ARG SRPM_ONLY=false

ENV BUILD_S3SELECT=${BUILD_S3SELECT}
ENV BUILD_S3SELECT_PARQUET=${BUILD_S3SELECT_PARQUET}
ENV CENTOS_VER=${CENTOS_VER}
ENV SRPM_ONLY=${SRPM_ONLY}
CMD ./packagerpm.sh /export /build
