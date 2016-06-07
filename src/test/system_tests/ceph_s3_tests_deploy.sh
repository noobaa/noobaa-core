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
DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"
TURN_DL="http://turnserver.open-sys.org/downloads/v4.3.1.3/turnserver-4.3.1.3-CentOS6.6-x86_64.tar.gz"
echo "Erase new version of libevent-2..."
yum -y erase libevent-2.0.21-2.el6.x86_64
echo "Finished Erasing new version of libevent-2..."
if [ ! -d $DIRECTORY ]; then
    echo "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    echo "Finished Downloading Ceph S3 Tests"
fi
echo "Installing virtualenv using Yum..."
yum install -y python-virtualenv
echo "Finished Installing virtualenv"
echo "Installing libxml2, libxslt..."
yum install -y libxml2
yum install -y libxslt
echo "Finished Installing libxml2, libxslt..."
echo "Running Bootstrap..."
cd $DIRECTORY
./bootstrap
echo "Finished Running Bootstrap..."
echo "Downloading turnserver package and unpacking..."
cd /tmp
curl -sL ${TURN_DL} | tar -xzv
echo "Finished Downloading turnserver package and unpacking..."
cd /tmp/turnserver-4.3.1.3
echo "Installing turnserver..."
/tmp/turnserver-4.3.1.3/install.sh
echo "Finished Installing turnserver..."
echo "Starting turnserver..."
supervisorctl start STUN
echo "Finished Starting turnserver..."
