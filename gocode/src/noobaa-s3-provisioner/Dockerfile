FROM golang:1.11.10

RUN mkdir -p /go/src/noobaa-s3-provisioner
COPY ./ /go/src/noobaa-s3-provisioner
WORKDIR /go/src/noobaa-s3-provisioner
RUN go build -a -o ./bin/noobaa-s3-provisioner  ./cmd/...

ENTRYPOINT ["/go/src/noobaa-s3-provisioner/bin/noobaa-s3-provisioner"]
CMD ["-v=2", "-alsologtostderr"]