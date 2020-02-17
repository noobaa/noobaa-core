FROM centos:8 
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: Installing pre requirments
#   Size: ~ 613 MB
#   Cache: Rebuild when we adding/removing requirments
##############################################################
ENV container docker
RUN dnf install -y -q wget unzip which vim && \
    dnf group install -y -q "Development Tools" && \
    dnf install -y -q python2 && \
    dnf clean all
RUN alternatives --set python /usr/bin/python2
RUN version="1.3.0" && \
    wget -q -O yasm-${version}.tar.gz https://github.com/yasm/yasm/archive/v${version}.tar.gz && \
    tar -xf yasm-${version}.tar.gz && \
    pushd yasm-${version} && \
    ./autogen.sh && \
    make && \
    make install && \
    popd && \
    rm -rf yasm-${version} yasm-${version}.tar.gz

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
    npm config set unsafe-perm true && \
    echo '{ "allow_root": true }' > /root/.bowerrc

##############################################################
# Layers:
#   Title: installing kubectl 
#   Size: ~ 43 MB
#   Cache: Rebuild the .nvmrc is changing
##############################################################
RUN stable_version=$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt) && \
    curl -LO https://storage.googleapis.com/kubernetes-release/release/${stable_version}/bin/linux/amd64/kubectl && \
    chmod +x ./kubectl

RUN mkdir -p /noobaa/src/
WORKDIR /noobaa
