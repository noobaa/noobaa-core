noobaa-core/deploy/NVA_build
===========

###src/deploy/NVA_build Table of Contents:

* [Files](#Files) - List of files and short description.
* [NVA_Build](#NVA_Build) - NooBaa Virtual Appliance building procedure.
* [UpgradePack_Build](#UpgradePack_Build) - Upgrade pack building procedure.


* ###Files

- deploy_base.sh - The master script for the NVA image creation.
- noobaa_supervisor.conf - Supervisord configuration for the NVA services (mongodb, webserver etc.)
- supervisord.orig - /etc/rc.d script for supervisord.
- noobaa_syslog.conf - rsyslog configuration file. directs all local0 messages to /log/noobaa.log
- upgrade - upgrade flow which runs from the crontab
- version_check.js - simple http request to the SaaS werbserver for version verification
- mongo.repo - mongodb repo definitions
- create_vm - Create the NVA machine using the VirtualBox CLI
- build_release.js - Node script which runs on our EC2 building server.
                     DEPRECATED & NOT COMPLETE.
- build_package.sh - Shell script runs on our EC2 building server.
- upgrade_wapper.sh - Comes with the upgrade package, contain pre and post execution
                      functions.


* ###NVA_Build (NooBaa Virtual Appliance):

- Build Procedure:
-
  1) Importing a base CentOS image (.OVA file)

  2) Running the following:

      2.1) yum -y update

      2.2) passwd -> current pass reverse change to roonoobaa

  4) SCP src/deploy/NVA_build/* and the noobaa package (as noobaa-NVA.tar.gz) to the machine at /tmp

  5) run /tmp/deploy_base runinstall

  6) Once done, export the machine to a .OVA file

  The created OVA file is the NVA which needs to be imported by the admin.
  create_vm is a script which automates this procedure. However, there are currently issues with
  the network after the initial import from the CentOS so it's not functional yet.

* ###UpgradePack_Build Upgrade package building and publishing:

  General Flow: SnapCI -> EC2 Building Server -> Upload to S3
                                              -> Create a new release in GitHub in the noobaa-core repo

  Building the Upgrade pack and publishing it to a S3 bucket is initiated by our noobaa-core repo pipeline in our CI
  environment SnapCI. It's a manual stage after running the tests (meaning it has to be invoked manually and can be done either if the tests
  passed or failed. Needless to say, it should be invoked if the test phase passed). Once the stage is invoked, it sends a ssh command
  to the EC2 Building Server indicating the hashtag of the desired repo version.

  The Building Server receives the request, clones the repo at the requested hashtag and builds the package. It also build the
  agent distribution package (which is a part of the upgrade package). After the package is build, it is uploaded to
  s3://noobaa-download/on_premise/v_<VERSION_NUMBER> and an appropriate VERSION_NUMBER release is created in GitHub.

  Accomodating the package itself is a wrapper script, containing pre (before new code extraction)
  and post (after new code extraction) commands to run during the upgrade flow.



