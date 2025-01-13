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
ARG BUILD_S3SELECT_PARQUET=0
# optional install rdma-core libraries
ARG USE_RDMA=0
# cuobj headers and libs paths, to be copied from build context
ARG CUOBJ_INC_PATH=/opt/cuObject/src/include
ARG CUOBJ_LIB_PATH=/opt/cuObject/src/lib

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

COPY ./src/deploy/NVA_build/install_arrow_build.sh ./src/deploy/NVA_build/install_arrow_build.sh
RUN if [ "$BUILD_S3SELECT_PARQUET" = "1" ]; then ./src/deploy/NVA_build/install_arrow_build.sh; fi

##############################################################
# Layers:
#   Title: RDMA libraries 
#   Size: ?
#   Cache: Rebuild when USE_RDMA arg changes
##############################################################

RUN if [ "$USE_RDMA" = "1" ]; then \
    dnf install -y -q rdma-core-devel libibverbs-devel && dnf clean all; \
fi

RUN if [ "$USE_RDMA" = "1" ] && [ "$CENTOS_VER" == "9" ]; then \
  echo "Installing RDMA cuobjserver rpm" && \
  wget https://developer.download.nvidia.com/compute/cuobjserver/1.0.0/local_installers/cuobjserver-local-repo-rhel9-1.0.0-1.0.0-1.x86_64.rpm && \
  rpm -i cuobjserver-local-repo-rhel9-1.0.0-1.0.0-1.x86_64.rpm && \
  dnf clean all && \
  dnf -y install cuobjserver; \
fi

# copy cuobj headers and libs if provided (provide dummy empty context dir otherwise)
COPY --from=cuobj_inc . $CUOBJ_INC_PATH
COPY --from=cuobj_lib . $CUOBJ_LIB_PATH

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
