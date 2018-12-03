FROM centos:7

MAINTAINER Jenia The Sloth <jeniawhite92@gmail.com>

#################
# INSTALLATIONS #
#################

RUN yum -y update
RUN yum -y install centos-release-scl
RUN yum -y install openssl
RUN yum -y install devtoolset-7

RUN yum -y remove epel-release
RUN yum -y --enablerepo=extras install epel-release

##############
# BASH SETUP #
##############

SHELL [ "/bin/bash", "-c" ]
ENV BASH_ENV '/etc/profile'
RUN echo '. /etc/profile' >> ~/.bashrc

################
# NOOBAA SETUP #
################

RUN mkdir -p /root/node_modules/noobaa-core
RUN mkdir -p /tmp

COPY ./noobaa-NVA.tar.gz /tmp/noobaa-NVA.tar.gz
# TOOD: Should be the local deploy_base.sh
COPY ./src/deploy/NVA_build/deploy_base.sh /tmp/deploy_base.sh
ENV container docker

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

RUN chmod +x /tmp/deploy_base.sh
CMD ["/usr/sbin/init"]