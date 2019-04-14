FROM centos:7 as base

RUN yum -y install epel-release openssl && \
    yum clean all

###########################
# NOOBAA AGENT BASE SETUP #
###########################
ENV container docker
RUN mkdir /noobaa_storage
ARG noobaa_agent_package=./noobaa-setup
ARG agent_entrypoint=./run_agent_container.sh
COPY ${noobaa_agent_package} .
COPY ${agent_entrypoint} .
RUN chmod +x run_agent_container.sh
RUN chmod +x noobaa-setup
# This is a dummy token in order to perform the installation
RUN ./noobaa-setup JZ-
RUN tar -zcvf noobaa.tar.gz /usr/local/noobaa/

######################################################
FROM centos:7
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

#################
# INSTALLATIONS #
#################
RUN yum -y install epel-release openssl && \
    yum clean all

################
# NOOBAA SETUP #
################
ENV container docker
RUN mkdir /noobaa_storage
ARG agent_entrypoint=./run_agent_container.sh
COPY --from=base ${agent_entrypoint} .
COPY --from=base ./noobaa.tar.gz .

###############
# PORTS SETUP #
###############
EXPOSE 60101-60600

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root group
USER 10001:0
ENTRYPOINT ["./run_agent_container.sh"]