#! /bin/bash
#
if [ ! -d "/noobaa" ]; then
	mkdir /noobaa
	cd /noobaa
	sudo apt-get update

    #swap
	sudo dd if=/dev/zero of=/root/myswapfile bs=1M count=5120
	sudo chmod 600 /root/myswapfile
	sudo mkswap /root/myswapfile
	sudo swapon /root/myswapfile
	sudo su -c "echo '/root/myswapfile	none	swap	sw	0	0' >> /etc/fstab"

	#new docker verion
	sudo apt-get install -y linux-image-generic-lts-trusty
	sudo apt-get install -y apparmor unzip
	wget -qO- https://get.docker.com/ | sh

	sudo usermod -aG docker "root"

	network=$(curl http://metadata/computeMetadata/v1/instance/attributes/network -H "Metadata-Flavor: Google")
	if [ $? -ne 0 ]; then
			network=1
	fi
	router=$(curl http://metadata/computeMetadata/v1/instance/attributes/router -H "Metadata-Flavor: Google")
	if [ $? -ne 0 ]; then
			router="0.0.0.0"
	fi
	agent_conf=$(curl http://metadata/computeMetadata/v1/instance/attributes/agent_conf -H "Metadata-Flavor: Google")
	if [ $? -ne 0 ]; then
			agent_conf="<agent_conf>"
	fi
	sudo curl -L git.io/weave -o /usr/local/bin/weave
	sudo chmod a+x /usr/local/bin/weave

	#sudo restart docker
	if [ $router != "0.0.0.0" ] ; then
		sudo weave launch --ipalloc-range 10.2.0.$network/16 --trusted-subnets 10.2.0.0/16 $router #104.155.2.195
	else
		sudo weave launch --ipalloc-range 10.2.0.1/16 --trusted-subnets 10.2.0.0/16
	fi

	curl http://noobaa-download.s3.amazonaws.com/DockerClientAmazon.zip >DockerClientAmazon.zip
	unzip DockerClientAmazon.zip
	#read metadata variable with env name. Defined in the gcloud.js (unique per instance)
	#replace ENV_PLACEHOLDER in Dockerfile and run-agent with current env
	ENV_NAME=$(curl http://metadata/computeMetadata/v1/instance/attributes/env -H "Metadata-Flavor: Google")

	echo '+++++ENV::::' $ENV_NAME
	if [ ${#ENV_NAME} -eq 0 ]; then
		#for amazon we will set it (for now), by replacing the env_name string from ec2_deploy_agents.js
		ENV_NAME='test'
	else
		echo 'EE' $ENV_NAME
	fi
	echo 'Current ENV:' $ENV_NAME
	sudo sed -i "s/<ENV_PLACEHOLDER>/$ENV_NAME/g" /noobaa/Dockerfile
	sudo sed -i "s/<AGENT_CONF_PLACEHOLDER>/$agent_conf/g" /noobaa/Dockerfile
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
	   let COUNTER=COUNTER+1
	   sleep $[ ( $RANDOM % 5 )  + 1 ]s
	done
else
	network=$(curl http://metadata/computeMetadata/v1/instance/attributes/network -H "Metadata-Flavor: Google")
	router=$(curl http://metadata/computeMetadata/v1/instance/attributes/router -H "Metadata-Flavor: Google")
	#remove weave and launch new one
	sudo docker rm  $(sudo docker ps -a |grep weave|awk '{print $1}')
	if [ $router != "0.0.0.0" ] ; then
		sudo weave launch --ipalloc-range 10.2.0.$network/16 --trusted-subnets 10.2.0.0/16 $router #104.155.2.195
	else
		sudo weave launch --ipalloc-range 10.2.0.1/16 --trusted-subnets 10.2.0.0/16
	fi
	sudo docker start  $(sudo docker ps -a|grep noobaa|awk '{print $1}')

fi
