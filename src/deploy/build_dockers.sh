#
#zip and upload to amazon s3 with public permissions
#

cd ./src/deploy/

rm DockerClientAmazon.zip
zip DockerClientAmazon.zip Dockerfile docker_setup.sh init.sh dockers_restart.sh start_noobaa_docker.sh supervisord.conf
s3cmd -P put DockerClientAmazon.zip s3://noobaa-download
s3cmd -P put docker_setup.sh s3://noobaa-download
s3cmd -P put init_agent.sh s3://noobaa-download
s3cmd -P put init_agent.bat s3://noobaa-download
rm DockerClientAmazon.zip
cd ..
cd ..
