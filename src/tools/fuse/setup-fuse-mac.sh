echo "Setting up s3fs-fuse for MAC ..."
pushd /tmp
git clone https://github.com/s3fs-fuse/s3fs-fuse.git
pushd s3fs-fuse

[ -d /usr/local/include/osxfuse ] || brew install osxfuse
[ -d /usr/local/opt/openssl ] || brew install openssl
[ -d /usr/local/opt/libxml2 ] || brew install libxml2
# let pkgconfig find the libxml-2.0.pc file so that configure can link to it
export PKG_CONFIG_PATH=/usr/local/opt/libxml2/lib/pkgconfig/

./autogen.sh
# running configure with explicit CFLAGS
./configure CFLAGS="-DPTHREAD_MUTEX_RECURSIVE_NP=PTHREAD_MUTEX_RECURSIVE -I/usr/local/opt/openssl/include"
make
sudo make install

popd
popd
