FROM centos:7
LABEL maintainer="Evgeniy Belyi (jeniawhite92@gmail.com)"

#################
# INSTALLATIONS #
#################

RUN yum -y update; yum clean all
RUN yum -y install epel-release; yum clean all
RUN yum -y install openssl; yum clean all

################
# NOOBAA SETUP #
################

ENV container docker
RUN mkdir /noobaa_storage
ARG noobaa_agent_package=./noobaa-setup
ARG agent_entrypoint=./src/deploy/NVA_build/run_agent_container.sh
COPY ${noobaa_agent_package} .
COPY ${agent_entrypoint} .
RUN chmod +x run_agent_container.sh
RUN chmod +x noobaa-setup
# This is a dummy token in order to perform the installation
RUN ./noobaa-setup JZ-
RUN rm -f /noobaa_storage/agent_conf.json

###############
# PORTS SETUP #
###############

EXPOSE 60101-60600

###############
# EXEC SETUP #
###############

ENTRYPOINT ["./run_agent_container.sh"]