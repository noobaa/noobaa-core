noobaa-core/deploy/NVA_build
===========

deploy_base.sh - The master script for the NVA image creation.
noobaa_supervisor.conf - Supervisord configuration for the NVA services (mongodb, webserver etc.)
supervisord.orig - /etc/rc.d script for supervisord.
upgrade - upgrade flow which runs from the crontab
version_check.js - simple http request to the SaaS werbserver for version verification
mongo.repo - mongodb repo definitions
create_vm - Create the NVA machine using the VirtualBox CLI
