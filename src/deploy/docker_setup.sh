#! /bin/bash
#
mkdir /noobaa
cd /noobaa
sudo apt-get update
sudo apt-get install -y docker.io unzip
curl http://elasticbeanstalk-us-west-2-628038730422.s3.amazonaws.com/DockerClient.zip >DockerClient.zip
unzip DockerClient.zip
#read metadata variable with env name. Defined in the gcloud.js (unique per instance)
#replace ENV_PLACEHOLDER in Dockerfile and run-agent with current env
ENV_NAME=$(curl http://metadata/computeMetadata/v1/instance/attributes/env -H "Metadata-Flavor: Google")
echo '+++++ENV::::' $ENV_NAME
if [ ${#ENV_NAME} -eq 0 ]; then
	#for amazon we will set it (for now), by replacing the env_name string from ec2.js
	ENV_NAME='test'
else
	echo 'EE' $ENV_NAME
fi
echo 'Current ENV:' $ENV_NAME
sudo sed -i "s/<ENV_PLACEHOLDER>/$ENV_NAME/g" /noobaa/Dockerfile
sudo sed -i "s/<ENV_PLACEHOLDER>/$ENV_NAME/g" /noobaa/start_noobaa_docker.sh
sudo docker build -t noobaa .
COUNTER=0
#read metadata variable with number of dockers. Defined in the gcloud.js (unique per instance)
number_of_dockers=$(curl http://metadata/computeMetadata/v1/instance/attributes/dockers -H "Metadata-Flavor: Google")
#in case of unexpected response, we will set 450 as default
re='^[0-9]+$'
if ! [[ $number_of_dockers =~ $re ]] ; then
   number_of_dockers=200
fi
while [  $COUNTER -lt $number_of_dockers ]; do
   sudo ./start_noobaa_docker.sh
   echo The counter is $COUNTER
   let COUNTER=COUNTER+1
   sleep $[ ( $RANDOM % 5 )  + 1 ]s
done
