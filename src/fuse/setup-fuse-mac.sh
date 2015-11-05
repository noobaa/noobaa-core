
pushd /tmp
git clone https://github.com/s3fs-fuse/s3fs-fuse.git
pushd s3fs-fuse
./autogen.sh

brew install libxml2
export PKG_CONFIG_PATH=/usr/local/Cellar/libxml2/2.9.2/lib/pkgconfig
./configure CFLAGS="-DPTHREAD_MUTEX_RECURSIVE_NP=PTHREAD_MUTEX_RECURSIVE -I/usr/local/opt/openssl/include"

make
sudo make install

popd
popd
