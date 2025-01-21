ARG CENTOS_VER=9
FROM quay.io/centos/centos:stream${CENTOS_VER} AS noobaa-builder
#Needs to reapply ARG, it was cleaned by FROM command.
ARG CENTOS_VER
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: Installing pre requirments
#   Size: ~ 613 MB (1324 MB with s3select for Parquet)
#   Cache: Rebuild when we adding/removing requirments
##############################################################
# RUN dnf --enablerepo=PowerTools install -y -q nasm && \
#     dnf clean all

COPY ./src/deploy/NVA_build/fix_centos8_repo.sh ./src/deploy/NVA_build/
#default repos for centos8 are outdated, this will point to new repos
RUN CENTOS_VER=${CENTOS_VER} ./src/deploy/NVA_build/fix_centos8_repo.sh
RUN dnf update -y -q --nobest && \
    dnf clean all
COPY ./src/deploy/NVA_build/install_arrow_build.sh ./src/deploy/NVA_build/install_arrow_build.sh
ARG BUILD_S3SELECT_PARQUET=0
RUN ./src/deploy/NVA_build/install_arrow_build.sh $BUILD_S3SELECT_PARQUET
RUN dnf install -y -q wget unzip which vim python3.9 boost-devel libcap-devel && \
    dnf group install -y -q "Development Tools" && \
    dnf clean all

# It's not important to report this failure (fails for Centos9)
RUN alternatives --auto python3 || exit 0

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
