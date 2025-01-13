FROM noobaa-builder AS rpm-builder

##########
## ARGS ##
##########

ARG CENTOS_VER=9
# args used by rpmbuild.sh and noobaa.spec (automatically propagated by RUN commands)
ARG SRPM_ONLY=false
ARG BUILD_S3SELECT=0
ARG USE_RDMA=0
ARG USE_CUDA=0
ARG GYP_DEFINES

# Install GCC11 toolchain on Centos8 to match the default toolchain of Centos9
RUN if [ "$CENTOS_VER" == "8" ]; then dnf install -y -q gcc-toolset-11; fi

COPY ./src/agent ./src/agent
COPY ./src/api ./src/api
COPY ./src/cmd ./src/cmd
COPY ./src/deploy/spectrum_archive ./src/deploy/spectrum_archive
COPY ./src/deploy/noobaa.service ./src/deploy/
COPY ./src/deploy/noobaa-cli ./src/deploy/
COPY ./src/deploy/nsfs_env.env ./src/deploy/
COPY ./src/deploy/NVA_build/clone_submodule.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/clone_s3select_submodules.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/install_nodejs.sh ./src/deploy/NVA_build/
COPY ./src/endpoint ./src/endpoint
COPY ./src/hosted_agents ./src/hosted_agents
COPY ./src/native ./src/native
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
COPY ./.gitignore ./
COPY ./src/deploy/standalone/noobaa_rsyslog.conf ./src/deploy/standalone/noobaa_rsyslog.conf
COPY ./src/deploy/standalone/noobaa_syslog.conf ./src/deploy/standalone/noobaa_syslog.conf
COPY ./src/deploy/standalone/noobaa-logrotate ./src/deploy/standalone/noobaa-logrotate
COPY ./src/manage_nsfs ./src/manage_nsfs
COPY ./src/nc ./src/nc
COPY ./src/deploy/RPM_build ./src/deploy/RPM_build

RUN mkdir -p /build /etc/noobaa.conf.d/

# ARGs are used by rpmbuild.sh either directly or by
# performing subsitutions in the noobaa.spec file
# Set GCC Toolset in path - won't exist in RHEL9 but that's OK
RUN PATH=/opt/rh/gcc-toolset-11/root/bin:$PATH \
  ./src/deploy/RPM_build/rpmbuild.sh /noobaa /build

# Last stage exports just the rpm files from the image built on previous stage.
# Expects to be used with `--output` flag of `docker build` or `podman build`.
# see https://docs.docker.com/engine/reference/commandline/build/#output
# or https://docs.podman.io/en/latest/markdown/podman-build.1.html#output-o-output-opts
FROM scratch AS export-stage
COPY --from=rpm-builder /build/*.rpm ./
