# top level args are visible only in FROM statements
ARG CENTOS_VER=9
ARG BUILDER_BASE_IMAGE=quay.io/centos/centos:stream${CENTOS_VER}

FROM ${BUILDER_BASE_IMAGE} AS noobaa-builder

##########
## ARGS ##
##########

# redeclare ARG inside build stage, even if declared on top level before.
ARG CENTOS_VER=9
# optional install arrow libraries for parquet support in s3select
ARG BUILD_S3SELECT=1
ARG BUILD_S3SELECT_PARQUET=0
# CUOBJ Server support
ARG USE_CUOBJ_SERVER=1

LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: Installing pre requirments
#   Size: ~ 613 MB (1324 MB with s3select for Parquet)
#   Cache: Rebuild when we adding/removing requirments
##############################################################

COPY ./src/deploy/NVA_build/fix_centos8_repo.sh ./src/deploy/NVA_build/
#default repos for centos8 are outdated, this will point to new repos
RUN CENTOS_VER=${CENTOS_VER} ./src/deploy/NVA_build/fix_centos8_repo.sh
RUN dnf update -y -q --nobest && \
    dnf clean all
RUN dnf install -y -q wget unzip which vim python3.9 boost-devel libcap-devel && \
    dnf group install -y -q "Development Tools" && \
    dnf clean all

# It's not important to report this failure (fails for Centos9)
RUN alternatives --auto python3 || exit 0

# wish we could do: RUN dnf --enablerepo=PowerTools install -y -q nasm && dnf clean all
RUN version="2.15.05" && \
    wget -q -O nasm-${version}.tar.gz https://github.com/netwide-assembler/nasm/archive/nasm-${version}.tar.gz && \
    tar -xf nasm-${version}.tar.gz && \
    pushd nasm-nasm-${version} && \
    ./autogen.sh && \
    ./configure && \
    make && \
    make install || true && \
    popd && \
    rm -rf nasm-${version} nasm-${version}.tar.gz

##############################################################
# Layers:
#   Title: Install arrow build libraries 
#   Size: ?
#   Cache: Rebuild when BUILD_S3SELECT_PARQUET arg changes
##############################################################
COPY ./src/deploy/NVA_build/install_arrow_build.sh ./src/deploy/NVA_build/install_arrow_build.sh
RUN if [ "$BUILD_S3SELECT_PARQUET" = "1" ]; then ./src/deploy/NVA_build/install_arrow_build.sh; fi

##############################################################
# Layers:
#   Title: Install cuobjserver build libraries 
#   Size: ?
#   Cache: Rebuild when USE_CUOBJ_SERVER arg changes
##############################################################
COPY ./src/deploy/RPM_build/install_cuobjserver_rpm.sh ./src/deploy/RPM_build/install_cuobjserver_rpm.sh
RUN if [ "$USE_CUOBJ_SERVER" = "1" ] && [ "$CENTOS_VER" = "9" ] && [ "$(uname -m)" = "x86_64" ]; then \
    ./src/deploy/RPM_build/install_cuobjserver_rpm.sh; \
fi

##############################################################
# Layers:
#   Title: Install node.js
#   Size: ~ 110 MB
#   Cache: Rebuild the .nvmrc is changing
##############################################################
COPY ./.nvmrc ./.nvmrc
COPY ./src/deploy/NVA_build/install_nodejs.sh ./
RUN chmod +x ./install_nodejs.sh && \
    ./install_nodejs.sh $(cat .nvmrc)
    
##############################################################
# Layers:
#   Title: installing kubectl 
#   Size: ~ 43 MB
##############################################################
RUN stable_version=$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt) && \
    MACHINE=$(uname -m); \
    if [ "$MACHINE" = "aarch64" ]; \
    then arch=arm64; \
    elif [ "$MACHINE" = "s380x" ]; \
    then arch=s390x; \
    elif [ "$MACHINE" = "ppc64le" ]; \
    then arch=ppc64le; \
    else arch=amd64; \
    fi && \
    curl -LO https://storage.googleapis.com/kubernetes-release/release/${stable_version}/bin/linux/${arch}/kubectl && \
    chmod +x ./kubectl

RUN mkdir -p /noobaa/src/
WORKDIR /noobaa
