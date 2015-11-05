function usage() {
    echo "  "
    echo "Usage: $0 <mount-point> <url> <flags>"
    echo "  "
    echo "Arguments:"
    echo "  mount-point - folder to mount, will be created if not exists"
    echo "  url         - http[s]://<access_key>:<secret_key>@<host>/<bucket>/<path>"
    echo "  flags       - additional flags to s3fs, like -f for foreground, etc"
    echo "  "
    exit 1
}

MOUNT_POINT=$1
[ -z "$MOUNT_POINT" ] && usage
shift

URL=$1
# parse the url parts
URL_PROTO="$(echo $URL | grep :// | sed -e 's,^\(.*\)://.*,\1,g')"
URL_WITHOUT_PROTO="$(echo ${URL/$URL_PROTO:\/\//})"
URL_USER="$(echo $URL_WITHOUT_PROTO | grep @ | cut -d: -f1)"
URL_PASS="$(echo $URL_WITHOUT_PROTO | grep @ | cut -d: -f2 | cut -d@ -f1)"
URL_HOST="$(echo ${URL_WITHOUT_PROTO/$URL_USER@/} | cut -d/ -f1)"
URL_PATH="$(echo $URL_WITHOUT_PROTO | grep / | cut -d/ -f2-)"
[ -z "$URL_PROTO" ] && URL_PROTO=http
[ -z "$URL_USER" ] && URL_USER=123
[ -z "$URL_PASS" ] && URL_PASS=abc
[ -z "$URL_HOST" ] && URL_HOST=127.0.0.1
[ -z "$URL_PATH" ] && URL_PATH=files
[ ! -z "$URL_PROTO" ] && { shift; }

S3FS_FLAGS="$*"

mkdir -p $MOUNT_POINT
chmod 777 $MOUNT_POINT

PASSWD_FILE=$(mktemp)
echo $URL_USER:$URL_PASS > $PASSWD_FILE
chmod 400 $PASSWD_FILE

S3FS_CMD="s3fs $URL_PATH $MOUNT_POINT \
-o url=${URL_PROTO}://$URL_HOST \
-o passwd_file=$PASSWD_FILE \
-o stat_cache_expire=3 \
-o enable_noobj_cache \
-o readwrite_timeout=20 \
-o use_path_request_style \
-o allow_other \
-o sigv2 \
$S3FS_FLAGS"

echo " > "
echo " >> "
echo " >>> Running: $S3FS_CMD"
echo " >> "
echo " > "
sudo $S3FS_CMD
