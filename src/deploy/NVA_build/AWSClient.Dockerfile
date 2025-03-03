FROM noobaa

USER 0:0

ENV container=docker
ENV TEST_CONTAINER=true

WORKDIR /root/node_modules/noobaa-core/

# check npm version
RUN npm -v
# install all dependencies (although we would like only the dev dependencies)
RUN npm install

############################################################################
# Layers:
#   Title: Install go and modules
#           for testing with AWS SDK GO client with most updated version

############################################################################

# installing go
RUN dnf install -y golang
# verify go installation
RUN go version
# set the PATH for go
ENV PATH="/usr/local/go/bin:$PATH"

# install the needed modules
# note: the files go.mod and go.sum will be automatically created after this step in the WORKDIR
RUN go mod init src/test/unit_tests/different_clients
RUN go mod tidy

USER 10001:0
