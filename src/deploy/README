Dockerfile - this is kind of template used to build docker image.
build.sh - zip all files and upload to s3 bucket
docker_setup.sh - setup script used by the VM instance. it fetch updated scripts from s3, install docker, build docker image and start docker instances.
init.sh - used by the docker instance itself. replaces the place holders for env and port in the supervisor configuration
run-agent.sh - used by the supervisor to run the actual noobaa agent
start_noobaa_docker.sh - used by docker_setup.sh. will run docker instance on the first available port.
supervisord.conf - used by supervisord to watch and run sshd and NooBaa agent.
build_atom_agent_win.sh - building windows installer based on atom_agent_win.nsi which is nsis script file
						  The build creates noobaa-setup.exe and push it to s3
ec2_wrapper - EC2 SDK wrapper for various tests and deployment flows
ec2_deploy_agents - deploy EC2 agents
