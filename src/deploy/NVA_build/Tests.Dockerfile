FROM centos:7
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

######################
# NOOBAA SETUP TESTS #
######################

ENV container docker
COPY /noobaa-core/ .
RUN yum install -y which && \
    yum clean all
RUN source /src/deploy/NVA_build/deploy_base.sh && \
    install_nodejs
RUN $(find / -name npm | head -1) install seedrandom

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root 
USER 10001:0
CMD ["/usr/local/bin/node", "-v"]