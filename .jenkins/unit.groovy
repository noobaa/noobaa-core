def cico_retries = 16
def cico_retry_interval = 60
def ci_git_repo = 'https://github.com/noobaa/noobaa-core'
def ci_git_ref = 'master' // default, will be overwritten for PRs

def HASH = '0123abcd' // default, will be overwritten
def NO_CACHE = 'NO_CACHE=true'
// Docker has some network conflicts in the CI, host-networking works
def USE_HOSTNETWORK = 'USE_HOSTNETWORK=true'
def CONTAINER_ENGINE = 'CONTAINER_ENGINE=docker'

node('cico-workspace') {
	if (params.ghprbPullId != null) {
		ci_git_ref = "pull/${ghprbPullId}/head"
	}

	stage('checkout ci repository') {
		// TODO: only need to fetch the .jenkins directory, no tags, ..
		checkout([$class: 'GitSCM', branches: [[name: 'FETCH_HEAD']],
			userRemoteConfigs: [[url: "${ci_git_repo}", refspec: "${ci_git_ref}"]]])
		// fetch the first 7 characters of the current commit hash
		HASH = sh(
			script: 'git log -1 --format=format:%H | cut -c-7',
			returnStdout: true
		).trim()
		env.IMAGE_TAG = "noobaa-${HASH}"
		env.TESTER_TAG = "noobaa-tester-${HASH}"
	}

	stage('reserve bare-metal machine') {
		def firstAttempt = true
		retry(30) {
			if (!firstAttempt) {
				sleep(time: 5, unit: "MINUTES")
			}
			firstAttempt = false
			cico = sh(
				script: "cico node get -f value -c hostname -c comment --release=8 \
							--retry-count=${cico_retries} --retry-interval=${cico_retry_interval}",
				returnStdout: true
			).trim().tokenize(' ')
			env.CICO_NODE = "${cico[0]}.ci.centos.org"
			env.CICO_SSID = "${cico[1]}"
			env.CICO_NODE_SSH = "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@${CICO_NODE}"
		}
	}

	try {
		stage('prepare bare-metal machine') {
			sh 'scp -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no ./.jenkins/prepare.sh root@${CICO_NODE}:'
			sh "${CICO_NODE_SSH} ./prepare.sh --workdir=/opt/build/noobaa-core --gitrepo=${ci_git_repo} --ref=${ci_git_ref}"
		}

		stage('stop jobs from the same PR') {
			jobs = sh(
				script: "${CICO_NODE_SSH} 'cd /opt/build/noobaa-core/.jenkins/ && ./get_job_numbers.sh --jobName ${JOB_NAME} \
							--currentBuild ${currentBuild.number} --JENKINS_URL ${JENKINS_URL}'",
				returnStdout: true
			).trim().tokenize(' ')
			if ( jobs.isEmpty() ) {
				println "There are no other builds for this PR, Skipping abort."
			} else {  
				for (JobNumber in jobs) {
					int JobNumberint = JobNumber as int
					println "Aborting ${JOB_NAME} ${JobNumber}"
					Jenkins.instance.getItemByFullName("${JOB_NAME}")
									.getBuildByNumber(JobNumberint)
									.finish(
									hudson.model.Result.ABORTED,
									new java.io.IOException("Aborting build")
								);	
				}
			}
		}

		// real test start here
		stage('Unit Tests') {
			// abort in case the test hangs
			timeout(time:30, unit: 'MINUTES') {
				sh "${CICO_NODE_SSH} 'cd /opt/build/noobaa-core && make test ${USE_HOSTNETWORK} ${CONTAINER_ENGINE}'"
			}
		}
	}

	finally {
		stage('return bare-metal machine') {
			sh 'cico node done ${CICO_SSID}'
		}
	}
}
