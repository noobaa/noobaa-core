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
# set the PATH for go
ENV PATH="/usr/local/go/bin:$PATH"

# install the needed modules
RUN go install github.com/aws/aws-sdk-go-v2/config@latest
RUN go install github.com/aws/aws-sdk-go-v2/credentials@latest
RUN go install github.com/aws/aws-sdk-go-v2/service/s3@latest
RUN go install github.com/aws/aws-sdk-go-v2/service/s3/types@latest
RUN go mod tidy
# copy the files
# COPY go.mod /root/node_modules/noobaa-core
# COPY go.sum /root/node_modules/noobaa-core

USER 10001:0
