# Continuous Integration Jobs for the CentOS CI

- [dedicated Jenkins instance][noobaa_ci] for NooBaa
- Jenkins is hosted on [OpenShift in the CentOS CI][app_ci_centos_org]
- scripts and Jenkins jobs are hosted in <some> repository
- a Jenkins Pipeline is used to reserve bare metal system(s), and run jobs on
  those systems

## `.jenkins` Directory Structure

This is the `.jenkins` directory, where all the scripts for the Jenkins jobs
are maintained. The tests that are executed by the jobs are part of the normal
project branches.

As an example, the `noobaa-core` Jenkins job consists out of the following
files:

- `jobs/noobaa-core.yaml` is a [Jenkins Job Builder][jjb] configuration
  that describes the events when the job should get run and fetches the
  `.groovy` file from the git repository/branch
- `noobaa-core.groovy` is the [Jenkins Pipeline][pipeline] that
  contains the stages for the Jenkins Job itself. In order to work with [the
  bare-metal machines from the CentOS CI][centos_ci_hw], it executes the
  following stages:

  1. dynamically allocate a Jenkins Slave (`node('cico-workspace')`) with tools
     and configuration to request a bare-metal machine
  1. checkout the repository, which contains scripts in the `.jenkins`
     directory for provisioning and preparing the environment for running tests
  1. reserve a bare-metal machine with `cico` (configured on the Jenkins Slave)
  1. provision the reserved bare-metal machine with additional tools and
     dependencies to run the test (see `prepare.sh` below)
  1. run "Unit Tests" and "Build & Sanity Integration Tests" in parallel
  1. as the final step, return the bare-metal machine to the CentOS CI for
     other users (it will be re-installed with a minimal CentOS environment
     again)

- `prepare.sh` installs dependencies for the test, and checks out the git
  repository and branch (or Pull Request) that contains the commits to be
  tested (and the test itself)

[noobaa_ci]: https://jenkins-noobaa.apps.ocp.ci.centos.org/
[app_ci_centos_org]: https://console-openshift-console.apps.ocp.ci.centos.org/k8s/cluster/projects/noobaa
[jjb]: https://jenkins-job-builder.readthedocs.io/en/latest/index.html
[pipeline]: https://docs.openstack.org/infra/jenkins-job-builder/project_pipeline.html
[centos_ci_hw]: https://wiki.centos.org/QaWiki/PubHardware
