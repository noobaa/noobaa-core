# #!/bin/bash
# DIRECTORY="s3-tests"
# CEPH_LINK="https://github.com/ceph/s3-tests.git"
# if [ ! -d $DIRECTORY ]; then
#     echo "Downloading Ceph S3 Tests..."
#     git clone $CEPH_LINK
#     echo "Finished Downloading Ceph S3 Tests"
# fi
# echo "Installing virtualenv using Yum..."
# yum install -y python-virtualenv
# #echo y
# echo "Finished Installing virtualenv"
# echo "Installing libxml2, libxslt..."
# #brew install libxml2
# #brew install libxslt
# #brew link libxml2 --force
# #brew link libxslt --force
# yum install -y libxml2
# yum install -y libxslt
# echo "Finished Installing libxml2, libxslt..."
# echo "Running Bootstrap..."
# cd $DIRECTORY
# ./bootstrap
#!/bin/bash
logger -p local0.info "ceph_s3_tests_deploy.sh executed."
DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"
TURN_DL="http://turnserver.open-sys.org/downloads/v4.3.1.3/turnserver-4.3.1.3-CentOS6.6-x86_64.tar.gz"
if [ ! -d $DIRECTORY ]; then
    echo "Remove centos-release-scl..."
    logger -p local0.info "Remove centos-release-scl..."
    yum -y remove centos-release-SCL

    echo "Install centos-release-scl..."
    logger -p local0.info "Install centos-release-scl..."
    yum -y install centos-release-scl
    echo "Finished Re-Installing centos-release-scl..."
    logger -p local0.info "Finished Re-Installing centos-release-scl..."

    echo "Erase new version of libevent-2..."
    logger -p local0.info "Erase new version of libevent-2..."
    yum -y erase libevent-2.0.21-2.el6.x86_64
    echo "Finished Erasing new version of libevent-2..."
    logger -p local0.info "Finished Erasing new version of libevent-2..."

    echo "Downloading Ceph S3 Tests..."
    logger -p local0.info "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    echo "Finished Downloading Ceph S3 Tests"
    logger -p local0.info "Finished Downloading Ceph S3 Tests"

    echo "Installing virtualenv using Yum..."
    logger -p local0.info "Installing virtualenv using Yum..."
    yum install -y python-virtualenv
    echo "Finished Installing virtualenv"
    logger -p local0.info "Finished Installing virtualenv"

    echo "Installing libxml2, libxslt..."
    logger -p local0.info "Installing libxml2, libxslt..."
    yum install -y libxml2
    yum install -y libxslt
    echo "Finished Installing libxml2, libxslt..."
    logger -p local0.info "Finished Installing libxml2, libxslt..."

    echo "Running Bootstrap..."
    logger -p local0.info "Running Bootstrap..."
    cd $DIRECTORY
    ./bootstrap
    touch ./s3tests/tests/__init__.py
    echo "Finished Running Bootstrap..."
    logger -p local0.info "Finished Running Bootstrap..."

    echo "Downloading turnserver package and unpacking..."
    logger -p local0.info "Downloading turnserver package and unpacking..."
    cd /tmp
    curl -sL ${TURN_DL} | tar -xzv
    echo "Finished Downloading turnserver package and unpacking..."
    logger -p local0.info "Finished Downloading turnserver package and unpacking..."

    cd /tmp/turnserver-4.3.1.3
    echo "Installing turnserver..."
    logger -p local0.info "Installing turnserver..."
    ./install.sh
    echo "Finished Installing turnserver..."
    logger -p local0.info "Finished Installing turnserver..."
    
    echo "Starting turnserver..."
    logger -p local0.info "Starting turnserver..."
    supervisorctl start STUN
    echo "Finished Starting turnserver..."
    logger -p local0.info "Finished Starting turnserver..."
fi