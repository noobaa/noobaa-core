# dev.Dockerfile is meant to be used manually for developer testing
ARG CENTOS_VER=9
FROM quay.io/centos/centos:stream${CENTOS_VER}

ENV container docker

RUN dnf update -y -q && \
    dnf install -y -q \
        bash bash-completion \
        wget curl nc unzip which less vim \
        python3 python3-setuptools \
        gdb strace lsof \
        openssl && \
    dnf --enablerepo=PowerTools install -y -q nasm && \
    dnf group install -y -q "Development Tools" && \
    dnf clean all

RUN mkdir -p /usr/local/lib/python3.6/site-packages
RUN alternatives --set python /usr/bin/python3

WORKDIR /noobaa

COPY ./.nvmrc ./.nvmrc
COPY ./src/deploy/NVA_build/install_nodejs.sh ./
RUN chmod +x ./install_nodejs.sh && \
    ./install_nodejs.sh $(cat .nvmrc)
    
COPY ./package*.json ./
RUN npm install && \
    npm cache clean --force

COPY . ./
USER 0:0
CMD [ "bash" ]
