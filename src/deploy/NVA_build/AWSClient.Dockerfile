FROM noobaa

USER 0:0

ENV container=docker
ENV TEST_CONTAINER=true

WORKDIR /root/node_modules/noobaa-core/

RUN npm install --only=dev

##############################################################
# Layers:
#   Title: Install go and modules fot testing with AWS SDK GO client
#   Size: ~ 79 M (download size) ~ 232 M (installed size) 
# This part was added to support running aws sdk go tests
##############################################################

# installing go
RUN dnf install -y golang
# verify installation
RUN go version
# set the PATH for go
ENV PATH="/usr/local/go/bin:$PATH"

# install the needed modules
RUN go mod init src/test/unit_tests/different_clients
RUN go mod tidy
# copy the files
# COPY go.mod /root/node_modules/noobaa-core
# COPY go.sum /root/node_modules/noobaa-core

USER 10001:0
