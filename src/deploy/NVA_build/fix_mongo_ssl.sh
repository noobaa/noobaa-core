CORE_DIR="/root/node_modules/noobaa-core"

if [ ! -d /data/mongo/ssl/ ]; then
  mkdir -p /data/mongo/ssl/
  mkdir -p /data/bin
  . ${CORE_DIR}/src/deploy/NVA_build/setup_mongo_ssl.sh
  chown -R mongod:mongod /data/mongo/
  chmod 400 -R /data/mongo/ssl/*
  chmod 500 /data/mongo/ssl
  client_subject=`openssl x509 -in /data/mongo/ssl/client.pem -inform PEM -subject -nameopt RFC2253 | grep subject | awk '{sub("subject= ",""); print}'`
  # add bash script to run mongo shell with authentications
  echo "mongo --ssl --sslPEMKeyFile /data/mongo/ssl/client.pem --sslCAFile /data/mongo/ssl/root-ca.pem --sslAllowInvalidHostnames -u \"${client_subject}\" --authenticationMechanism MONGODB-X509 --authenticationDatabase \"\\\$external\" \"\$@\"" > /data/bin/mongors
  chmod +x /data/bin/mongors
fi

if ! grep -q MONGO_SSL_USER /data/.env; then
  client_subject=`openssl x509 -in /data/mongo/ssl/client.pem -inform PEM -subject -nameopt RFC2253 | grep subject | awk '{sub("subject= ",""); print}'`
  echo "MONGO_SSL_USER=${client_subject}" >> /data/.env
fi

