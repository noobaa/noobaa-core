# Fuse setup script for debian

#optional settings for sources.
#echo deb http://ftp.ca.debian.org/debian testing main >/etc/apt/sources.list
#echo deb-src http://ftp.ca.debian.org/debian testing main >>/etc/apt/sources.list
#echo deb http://ftp.debian.org/debian/ jessie-updates main >>/etc/apt/sources.list
#echo deb-src http://ftp.debian.org/debian/ jessie-updates main >>/etc/apt/sources.list
#apt-get update

sudo apt-get install libfuse-dev libcurl4-openssl-dev libxml++2.6-dev libssl-dev git automake make g++ -y
cd /tmp
git clone https://github.com/s3fs-fuse/s3fs-fuse.git
cd s3fs-fuse
./autogen.sh
./configure
make
make install
mkdir /noobaa
chmod 777 /noobaa
echo 123:abc > passwd
chmod 600 passwd
s3fs files /noobaa -o passwd_file=./passwd -ouse_path_request_style -ourl=http://<REPLACE THIS WITH NOOBAA SERVER NAME OR IP> -osigv2
