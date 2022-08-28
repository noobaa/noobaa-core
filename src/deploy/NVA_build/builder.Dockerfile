FROM quay.io/centos/centos:stream8
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: Installing pre requirments
#   Size: ~ 613 MB
#   Cache: Rebuild when we adding/removing requirments
##############################################################
# RUN dnf --enablerepo=PowerTools install -y -q nasm && \
#     dnf clean all
RUN dnf update -y -q --nobest && \
    dnf clean all
RUN dnf install -y -q wget unzip which vim python2 python3 && \
    dnf group install -y -q "Development Tools" && \
    dnf clean all
RUN alternatives --set python /usr/bin/python3
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
    ./install_nodejs.sh $(cat .nvmrc) && \
    npm config set unsafe-perm true 

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
