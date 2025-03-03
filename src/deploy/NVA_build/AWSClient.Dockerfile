FROM noobaa-tester

USER 0:0

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
# copy the files
COPY go.mod /root/node_modules/noobaa-core
COPY go.sum /root/node_modules/noobaa-core
# install modules and set the PATH for go
RUN go mod tidy
ENV PATH="/usr/local/go/bin:$PATH"

USER 10001:0
