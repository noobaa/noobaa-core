## variables
CUDA_PATH="$(realpath /usr/local/cuda)"
CUOBJ_PATH="$(realpath ../cuObject-0.8.1-Linux_x86_64/src)"
CUFILE_ENV_PATH_JSON="$(realpath ../cuobj.json)"
CUOBJ_LIBS="$CUOBJ_PATH/lib/libcuobjserver.so $CUOBJ_PATH/lib/libcuobjclient.so $CUOBJ_PATH/lib/libcufile.so.1.13.0 $CUOBJ_PATH/lib/libcufile_rdma.so.1.13.0"

## git push to hosts
./rdma-push.sh

## build script
./rdma-build.sh

## build commands
make RDMA=1
make RDMA=1 CUDA=1

# quick rebuild:
rm -rf build/Release/obj.target/{rdma,cuda}_napi/ &&
  rm -f  build/Release/{rdma,cuda}_napi.a &&
  rm -f  build/Release/nb_native.node


## rdma_speed
UV_THREADPOOL_SIZE=4 LD_PRELOAD="$CUOBJ_LIBS" node src/tools/rdma_speed.js --server
UV_THREADPOOL_SIZE=4 LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" node src/tools/rdma_speed.js --client --op GET
UV_THREADPOOL_SIZE=4 LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" node src/tools/rdma_speed.js --client --op PUT
  # --op PUT --forks 1 --concur 16
  # --pool_size $((4*32)) --size 32
  # --perf-basic-prof 

## http_speed
node src/tools/http_speed.js --server             --buf $((8*1024*1024)) --size 8 --forks 8
node src/tools/http_speed.js --client 172.16.0.61 --buf $((8*1024*1024)) --size 8 --forks 8 --concur 8 --method GET
node src/tools/http_speed.js --client 172.16.0.61 --buf $((8*1024*1024)) --size 8 --forks 8 --concur 8 --method PUT

## noobaa server (local ips 172.16.0.61 and 172.16.0.71)
LD_PRELOAD="$CUOBJ_LIBS" LOCAL_IP=172.16.0.61 node src/cmd/nsfs.js
LD_PRELOAD="$CUOBJ_LIBS" LOCAL_IP=172.16.0.71 node src/cmd/nsfs.js

## cuobj benchmark
LD_PRELOAD="$CUOBJ_LIBS" benchmark/cuobjio_server -a 172.16.0.61 -P /root/guym/cuobjio_server_objects
LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" benchmark/cuobjio_client -a 172.16.0.61 -T 10 -s $((8*1024*1024)) -t 16 -i 1 -m 0 // 16x PUT (CUDA_MALLOC)
LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" benchmark/cuobjio_client -a 172.16.0.61 -T 10 -s $((8*1024*1024)) -t 16 -i 1 -m 1 // 16x PUT (HOST_MEM)
LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" benchmark/cuobjio_client -a 172.16.0.61 -T 10 -s $((8*1024*1024)) -t 16 -i 0 -m 0 // 16x GET (CUDA_MALLOC)
LD_PRELOAD="$CUOBJ_LIBS" CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" benchmark/cuobjio_client -a 172.16.0.61 -T 10 -s $((8*1024*1024)) -t 16 -i 0 -m 1 // 16x GET (HOST_MEM)

####################################################
## client (local ips 172.16.0.62 and 172.16.0.72) ##
####################################################

## s3cat
DISABLE_INIT_RANDOM_SEED=true \
  node src/tools/s3cat.js \
  --endpoint http://172.16.0.61:6001 \
  --access_key $AWS_ACCESS_KEY_ID \
  --secret_key $AWS_SECRET_ACCESS_KEY \
  --bucket bucket1 \
  --ls

  # --upload
  # --get upload-m6s4i12b


UV_THREADPOOL_SIZE=4 \
  DISABLE_INIT_RANDOM_SEED=true \
  LD_PRELOAD="$CUOBJ_LIBS" \
  CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" \
  node src/tools/s3perf.js \
  --local_ip 172.16.0.62 \
  --endpoint http://172.16.0.61:6001 \
  --selfsigned \
  --access_key $AWS_ACCESS_KEY_ID \
  --secret_key $AWS_SECRET_ACCESS_KEY \
  --bucket bucket1 \
  --time 120 \
  --get fs_speed \
  --concur 1 \
  --forks 1 \
  --rdma \
  --cuda


## warp
../warp get \
  --host 172.16.0.61:6001 \
  --access-key $AWS_ACCESS_KEY_ID \
  --secret-key $AWS_SECRET_ACCESS_KEY \
  --duration 20s \
  --obj.size 100MiB \
  --objects 100 \
  --concurrent 20 \
  --disable-multipart \
  --disable-sha256-payload \
  --noclear \
  --list-existing

#################################
# server cpu
while true; do top -b -c -w 500 -d 0.5 -n 10 | grep noobaa | awk '{s+=$9} END {print strftime("%T"),"CPU% =",s/10}'; done
# client cpu
while true; do top -b -c -w 500 -d 0.5 -n 10 | grep node | awk '{s+=$9} END {print strftime("%T"),"CPU% =",s/10}'; done
