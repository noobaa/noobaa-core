FROM noobaa-base
ARG TARGETARCH
ARG BUILD_S3SELECT=0

RUN mkdir -p /etc/logrotate.d/noobaa/
RUN mkdir -p /etc/noobaa.conf.d/

COPY ./src/agent ./src/agent
COPY ./src/api ./src/api
COPY ./src/cmd ./src/cmd
COPY ./src/deploy/spectrum_archive ./src/deploy/spectrum_archive
COPY ./src/endpoint ./src/endpoint
COPY ./src/hosted_agents ./src/hosted_agents
COPY ./src/rpc ./src/rpc
COPY ./src/s3 ./src/s3
COPY ./src/sdk ./src/sdk
COPY ./src/server ./src/server
COPY ./src/tools ./src/tools
COPY ./src/upgrade ./src/upgrade
COPY ./src/util ./src/util
COPY ./config.js ./
COPY ./platform_restrictions.json ./
COPY ./Makefile ./
COPY ./package*.json ./
COPY ./src/deploy/standalone/noobaa_rsyslog.conf ./src/deploy/standalone/noobaa_rsyslog.conf
COPY ./src/deploy/standalone/noobaa_syslog.conf ./src/deploy/standalone/noobaa_syslog.conf
COPY ./src/deploy/standalone/logrotate_noobaa.conf ./src/deploy/standalone/logrotate_noobaa.conf

WORKDIR /build

RUN tar -czvf noobaa-core.tar.gz /noobaa

COPY ./src/deploy/RPM_build/* ./
COPY ./package.json ./
RUN chmod +x ./packagerpm.sh

CMD ./packagerpm.sh /export /build
