FROM centos:8 

ENV container docker

RUN dnf update -y -q && \
    dnf install -y -q \
        bash bash-completion \
        wget curl nc unzip which less vim \
        python2 python2-setuptools \
        python3 python3-setuptools \
        gdb strace lsof \
        openssl && \
    dnf --enablerepo=PowerTools install -y -q yasm && \
    dnf group install -y -q "Development Tools" && \
    dnf clean all

RUN mkdir -p /usr/local/lib/python3.6/site-packages
RUN alternatives --set python /usr/bin/python3

WORKDIR /noobaa

COPY ./.nvmrc ./.nvmrc
COPY ./src/deploy/NVA_build/install_nodejs.sh ./
RUN chmod +x ./install_nodejs.sh && \
    ./install_nodejs.sh $(cat .nvmrc) && \
    npm config set unsafe-perm true && \
    echo '{ "allow_root": true }' > /root/.bowerrc

COPY ./package*.json ./
RUN npm install && \
    npm cache clean --force

COPY . ./
USER 0:0
CMD [ "bash" ]
