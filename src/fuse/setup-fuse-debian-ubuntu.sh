echo "Setting up s3fs-fuse for debian/ubuntu ..."
pushd /tmp
git clone https://github.com/s3fs-fuse/s3fs-fuse.git
pushd s3fs-fuse

#optional settings for sources.
#echo deb http://ftp.ca.debian.org/debian testing main >/etc/apt/sources.list
#echo deb-src http://ftp.ca.debian.org/debian testing main >>/etc/apt/sources.list
#echo deb http://ftp.debian.org/debian/ jessie-updates main >>/etc/apt/sources.list
#echo deb-src http://ftp.debian.org/debian/ jessie-updates main >>/etc/apt/sources.list
#apt-get update

sudo apt-get install libfuse-dev libcurl4-openssl-dev libxml++2.6-dev libssl-dev git automake make g++ -y

./autogen.sh
./configure
make
sudo make install

popd
popd
