FROM centos:7

MAINTAINER Jenia The Sloth <jeniawhite92@gmail.com>

#################
# SYSTEMD SETUP #
#################
RUN (cd /lib/systemd/system/sysinit.target.wants/; for i in *; do [ $i == systemd-tmpfiles-setup.service ] || rm -f $i; done); \
    rm -f /lib/systemd/system/multi-user.target.wants/*;\
    rm -f /etc/systemd/system/*.wants/*;\
    rm -f /lib/systemd/system/local-fs.target.wants/*; \
    rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
    rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
    rm -f /lib/systemd/system/basic.target.wants/*;\
    rm -f /lib/systemd/system/anaconda.target.wants/*;

VOLUME ["/sys/fs/cgroup"]


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
EXPOSE 60100-60600
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
CMD ["/usr/sbin/init"]
