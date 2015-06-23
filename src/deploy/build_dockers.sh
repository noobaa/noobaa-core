#
#zip and upload to amazon s3 with public permissions
#
# default - clean build
SYSTEM="demo"
ADDRESS="http://127.0.0.1:5001"
ACCESS_KEY="123"
SECRET_KEY="abc"
SYSTEM_ID="0"


function usage {
  #Usage:
  #./src/deploy/build.sh --system_id=5562f0a --access_key=123 --secret_key=abc --system=demo --address=wss://52.28.110.142
  echo "usage: <--system_id> <--system> <--address[:port]> <--access_key> <--secret_key>"
  echo "example: build_docker.sh --system_id=5562f0a --access_key=123 --secret_key=abc --system=demo --address=wss://52.28.110.142:8443"
  exit 1
}

#extract parms
if [[ $# -eq 0 ]]; then
  usage
fi

while [[ $# > 0 ]]; do
  key=$(echo $1 | sed "s:\(.*\)=.*:\1:")
  case $key in
      --system_id)
      SYSTEM_ID=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
      --system)
      SYSTEM=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
      --address)
      ADDRESS=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    --access_key)
      ACCESS_KEY=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    --secret_key)
      SECRET_KEY=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    *)
      usage

      # unknown option
      ;;
  esac
  shift
done

cd ./src/deploy/

echo "SYSTEM:$SYSTEM"
echo "ADDRESS:$ADDRESS"
echo "ACCESS_KEY:$ACCESS_KEY"
echo "SECRET_KEY:$SECRET_KEY"

echo "create agent conf"
echo '{' > agent_conf.json
echo '    "dbg_log_level": 2,' >> agent_conf.json
echo '    "address": "'"$ADDRESS"'",' >> agent_conf.json
echo '    "system": "'"$SYSTEM"'",' >> agent_conf.json
echo '    "tier": "nodes",' >> agent_conf.json
echo '    "prod": "true",' >> agent_conf.json
echo '    "bucket": "files",' >> agent_conf.json
echo '    "root_path": "./agent_storage/",' >> agent_conf.json
echo '    "access_key":"'"$ACCESS_KEY"'",' >> agent_conf.json
echo '    "secret_key":"'"$SECRET_KEY"'"' >> agent_conf.json
echo '}' >> agent_conf.json

cat agent_conf.json

rm DockerClientAmazon.zip
zip DockerClientAmazon.zip Dockerfile docker_setup.sh init.sh run-agent.sh dockers_restart.sh start_noobaa_docker.sh supervisord.conf agent_conf.json
s3cmd ls s3://noobaa-download
s3cmd -P put DockerClientAmazon.zip s3://noobaa-download
s3cmd -P put docker_setup.sh s3://noobaa-download
s3cmd -P put init_agent.sh s3://noobaa-download
s3cmd -P put init_agent.bat s3://noobaa-download
s3cmd -P put init_agent_client.sh s3://noobaa-download
s3cmd -P put init_agent_test.sh s3://noobaa-download
rm agent_conf.json
rm DockerClientAmazon.zip
cd ..
cd ..
