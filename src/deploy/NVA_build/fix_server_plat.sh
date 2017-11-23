NOOBAASEC="/etc/noobaa_sec"


# If not sec file, fix it
if [ ! -f ${NOOBAASEC} ]; then
  sec=$(uuidgen | cut -f 1 -d'-')
  echo ${sec} | tee -a ${NOOBAASEC}
  #dev/null to avoid output with user name
  echo ${sec} | passwd noobaaroot --stdin >/dev/null
  sed -i "s:No Server Secret.*:This server's secret is \x1b[0;32;40m${sec}\x1b[0m:" /etc/issue

  #verify JWT_SECRET exists in .env, if not create it
  if ! grep -q JWT_SECRET /root/node_modules/noobaa-core/.env; then
      jwt=$(cat /etc/noobaa_sec | openssl sha512 -hmac | cut -c10-44)
      echo "JWT_SECRET=${jwt}"  >> /root/node_modules/noobaa-core/.env
  fi
  if grep -q PLATFORM=aws /root/node_modules/noobaa-core/.env; then 
  	instance_id=$(curl http://169.254.169.254/latest/meta-data/instance-id)
  	curl -H "Content-Type: application/json" -X POST -d '{"properties__email__value":"'${instance_id}'@noobaa.com"}' https://hooks.zapier.com/hooks/catch/440450/52rywu/
  fi
fi

# if running on AWS then write\fix the region in .env
if grep -q "PLATFORM=aws" /root/node_modules/noobaa-core/.env; then
  cd /root/node_modules/noobaa-core/
  /usr/local/bin/node /root/node_modules/noobaa-core/src/deploy/NVA_build/prepare_aws_platform.js
fi
