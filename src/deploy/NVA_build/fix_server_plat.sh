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

  #Reload services so they would read the newly created JWT
  supervisorctl restart bg_workers hosted_agents s3rver webserver || true
fi

