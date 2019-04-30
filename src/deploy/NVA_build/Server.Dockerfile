FROM centos:7
LABEL maintainer="Evgeniy Belyi (jeniawhite92@gmail.com)"

################
# NOOBAA SETUP #
################

ARG noobaa_rpm=./noobaa.rpm
ARG install_script=./src/deploy/rpm/install_noobaa.sh
ENV container docker
COPY ${noobaa_rpm} /tmp/noobaa.rpm
COPY ${install_script} /tmp/install_noobaa.sh
RUN chmod +x /tmp/install_noobaa.sh
RUN /bin/bash -xc "/tmp/install_noobaa.sh"

###############
# PORTS SETUP #
###############
EXPOSE 60100
EXPOSE 80
EXPOSE 443
EXPOSE 8080
EXPOSE 8443
EXPOSE 8444
EXPOSE 27000
EXPOSE 26050

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root 
USER 10001:0
CMD ["/usr/bin/supervisord", "start_container"]
