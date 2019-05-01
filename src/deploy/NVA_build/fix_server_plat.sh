#!/bin/bash

NOOBAASEC="/data/noobaa_sec"
CORE_DIR="/root/node_modules/noobaa-core"

# If not sec file, fix it
if [ ! -f ${NOOBAASEC} ]; then
  if [ ! -f /data/noobaa_supervisor.conf ]; then
    # when running in kubernetes\openshift we mount PV under /data and /log
    # ensure existence of folders such as mongo, supervisor, etc.
    mkdir -p /log/supervisor
    mkdir -p /data/mongo/cluster/shard1
    if [ "${container}" == "docker" ] ; then
      # Setup Repos
      sed -i -e "\$aPLATFORM=docker" ${CORE_DIR}/src/deploy/NVA_build/env.orig
      # in a container set the endpoint\ssl ports to 6001\6443 since we are not running as root
      echo "ENDPOINT_PORT=6001" >> ${CORE_DIR}/src/deploy/NVA_build/env.orig
      echo "ENDPOINT_SSL_PORT=6443" >> ${CORE_DIR}/src/deploy/NVA_build/env.orig
    else
      chown -R mongod:mongod /data/mongo/
    fi
    cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig /data/.env &>> /data/mylog
    cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /data &>> /data/mylog
  fi

  sec=$(uuidgen | cut -f 1 -d'-')
  echo ${sec} | tee -a ${NOOBAASEC}
  #dev/null to avoid output with user name
  echo ${sec} | passwd noobaaroot --stdin >/dev/null
  sed -i "s:No Server Secret.*:This server's secret is \x1b[0;32;40m${sec}\x1b[0m:" /etc/issue
  #verify JWT_SECRET exists in .env, if not create it
  if ! grep -q JWT_SECRET /data/.env; then
    jwt=$(cat /data/noobaa_sec | openssl sha512 -hmac | cut -c10-44)
    echo "JWT_SECRET=${jwt}" >> /data/.env
  fi

  if grep -q PLATFORM=aws /data/.env; then
    instance_id=$(curl http://169.254.169.254/latest/meta-data/instance-id)
    public_ip=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
    #write\fix the region in .env
    cd /root/node_modules/noobaa-core/
    /usr/local/bin/node /root/node_modules/noobaa-core/src/deploy/NVA_build/prepare_aws_platform.js
    #paid version. auto register
    if grep -q AWS_PRODUCT_CODE=8q32hahci09vwgsx568lhrzwl /data/.env; then
      curl -H "Content-Type: application/json" -X POST -d '{"properties__email__value":"'${instance_id}'@noobaa.com"}' https://hooks.zapier.com/hooks/catch/440450/52rywu/
      curl -H "Content-Type: application/json" -X POST -d '{"aws-marketplace":{"instance":"'paid ${instance_id}'","ip":"'${public_ip}'"}}' https://hooks.zapier.com/hooks/catch/440450/sa64s0/
    else
      #BYOL, notify
      curl -H "Content-Type: application/json" -X POST -d '{"aws-marketplace BYOL :{"instance":"'${instance_id}'","ip":"'${public_ip}'"}}' https://hooks.zapier.com/hooks/catch/440450/sa64s0/
    fi
  fi

  #alyun specific platform fixes
  if grep -q PLATFORM=alyun /data/.env; then
    instance_id=$(curl http://100.100.100.200/latest/meta-data/instance-id)
    public_ip=$(curl http://100.100.100.200/latest/meta-data/eipv4)
    curl -H "Content-Type: application/json" -X POST -d '{"aws-marketplace":{"instance":"alibaba '${instance_id}'","ip":"'${public_ip}'"}}' https://hooks.zapier.com/hooks/catch/440450/sa64s0/
  fi

  #google specific platform fixes
  if grep -q PLATFORM=google /data/.env; then
    instance_id=$(curl http://metadata.google.internal/computeMetadata/v1/instance/id -H "Metadata-Flavor: Google")
    public_ip=$(curl http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google")
    curl -H "Content-Type: application/json" -X POST -d '{"aws-marketplace":{"instance":"google test drive'${instance_id}'","ip":"'${public_ip}'"}}' https://hooks.zapier.com/hooks/catch/440450/sa64s0/
    if  grep -q PAID=true /data/.env; then
      echo "AWS_INSTANCE_ID=${instance_id}" >> /data/.env
      curl -H "Content-Type: application/json" -X POST -d '{"properties__email__value":"'${instance_id}'@noobaa.com"}' https://hooks.zapier.com/hooks/catch/440450/52rywu/
    fi
  fi

  #azure specific platform fixes
  if grep -q PLATFORM=azure /data/.env; then
    instance_id=$(curl -H Metadata:true "http://169.254.169.254/metadata/instance/compute/vmId?api-version=2017-04-02&format=text")
    public_ip=$(curl -H Metadata:true "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2017-04-02&format=text")
    curl -H "Content-Type: application/json" -X POST -d '{"aws-marketplace":{"instance":"Azure markeplace'${instance_id}'","ip":"'${public_ip}'"}}' https://hooks.zapier.com/hooks/catch/440450/sa64s0/
    if  grep -q PAID=true /data/.env; then
      echo "AWS_INSTANCE_ID=${instance_id}" >> /data/.env
      curl -H "Content-Type: application/json" -X POST -d '{"properties__email__value":"'${instance_id}'@noobaa.com"}' https://hooks.zapier.com/hooks/catch/440450/52rywu/
    fi
  fi
fi
