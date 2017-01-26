function usage() {
    SCRIPT="$(basename $0)"
    echo "  "
    echo "Usage: $SCRIPT <mount-point> <url> <flags>"
    echo "  "
    echo "Arguments:"
    echo "  mount-point - folder to mount, will be created if not exists"
    echo "  url         - http[s]://<access_key>:<secret_key>@<host>/<bucket>/<path>"
    echo "  flags       - additional flags to s3fs, like -f for foreground, etc"
    echo "  "
    echo "Examples:"
    echo "  $SCRIPT"
    echo "      - show this usage"
    echo "  $SCRIPT /mnt/noobaa"
    echo "      - url will fill with defaults: http://123:abc@127.0.0.1/files)"
    echo "  $SCRIPT /mnt/noobaa https://my-noobaa-server/movies"
    echo "      - url will fill with defaults: https://123:abc@my-noobaa-server/movies)"
    echo "  "
    exit 1
}

MOUNT_POINT=$1
[ -z "$MOUNT_POINT" ] && usage
shift

# parse the url parts
# if the url does not start with protocol format,
# then we assume there is no url and just consider it as flags
S3FS_URL=$1
S3FS_PROTO="$(echo $S3FS_URL | grep :// | sed -e 's,^\(.*\)://.*,\1,g')"
if [ ! -z "$S3FS_PROTO" ]
then
    URL_WITHOUT_PROTO="$(echo ${S3FS_URL/$S3FS_PROTO:\/\//})"
    S3FS_ACCESS_KEY="$(echo $URL_WITHOUT_PROTO | grep @ | cut -d: -f1)"
    S3FS_SECRET_KEY="$(echo $URL_WITHOUT_PROTO | grep @ | cut -d: -f2 | cut -d@ -f1)"
    S3FS_HOST="$(echo ${URL_WITHOUT_PROTO/$S3FS_ACCESS_KEY@/} | cut -d/ -f1)"
    S3FS_BUCKET="$(echo $URL_WITHOUT_PROTO | grep / | cut -d/ -f2-)"
    shift
fi
S3FS_FLAGS="$*"

# use url defaults
[ -z "$S3FS_PROTO" ] && S3FS_PROTO=http
[ -z "$S3FS_HOST" ] && S3FS_HOST=127.0.0.1
[ -z "$S3FS_ACCESS_KEY" ] && S3FS_ACCESS_KEY=123
[ -z "$S3FS_SECRET_KEY" ] && S3FS_SECRET_KEY=abc
[ -z "$S3FS_BUCKET" ] && S3FS_BUCKET=files

mkdir -p $MOUNT_POINT
chmod 777 $MOUNT_POINT

PASSWD_FILE=$(mktemp)
echo $S3FS_ACCESS_KEY:$S3FS_SECRET_KEY > $PASSWD_FILE
chmod 400 $PASSWD_FILE

S3FS_CMD="s3fs $S3FS_BUCKET $MOUNT_POINT \
-o url=${S3FS_PROTO}://$S3FS_HOST \
-o passwd_file=$PASSWD_FILE \
-o stat_cache_expire=3 \
-o enable_noobj_cache \
-o readwrite_timeout=20 \
-o use_path_request_style \
-o allow_other \
-o no_check_certificate \
-o sigv2 \
-f \
$S3FS_FLAGS"

echo " > "
echo " >> "
echo " >>> Running: $S3FS_CMD"
echo " >> "
echo " > "
sudo $S3FS_CMD
