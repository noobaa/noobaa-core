FROM alpine:3.8

ENV OPERATOR=/usr/local/bin/noobaa-operator \
    USER_UID=1001 \
    USER_NAME=noobaa-operator

# install operator binary
COPY build/_output/bin/noobaa-operator ${OPERATOR}

COPY build/bin /usr/local/bin

RUN mkdir -p /noobaa_yaml
COPY build/*.yaml /noobaa_yaml/

RUN /usr/local/bin/user_setup

ENTRYPOINT ["/usr/local/bin/entrypoint"]

USER ${USER_UID}
