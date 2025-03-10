BUILDER_TAG?="noobaa-builder"
NOOBAA_BASE_TAG?="noobaa-base"
NOOBAA_TAG?="noobaa"
TESTER_TAG?="noobaa-tester"
NOOBAA_RPM_TAG?="noobaa-rpm-build"
POSTGRES_IMAGE?="centos/postgresql-12-centos7"
MONGO_IMAGE?="centos/mongodb-36-centos7"
CENTOS_VER?=9

CONTAINER_ENGINE?=$(shell docker version >/dev/null 2>&1 && echo docker)
ifeq ($(CONTAINER_ENGINE),)
	CONTAINER_ENGINE=$(shell podman version >/dev/null 2>&1 && echo podman)
endif
ifeq ($(CONTAINER_ENGINE),)
	CONTAINER_ENGINE=$(shell lima nerdctl version >/dev/null 2>&1 && echo lima nerdctl)
endif

# If CONTAINER_PLATFORM is not set, then set automatically based on the host.
ifeq ($(CONTAINER_PLATFORM),)
# see https://github.com/containerd/nerdctl/blob/main/docs/multi-platform.md
# e.g use CONTAINER_PLATFORM=amd64 for building x86_64 on arm.
	CONTAINER_PLATFORM=$(shell [ "`arch`" = "arm64" ] || [ "`arch`" = "aarch64" ] && echo amd64)

	ifneq ($(strip $(CONTAINER_PLATFORM)),)
		ifeq ($(CONTAINER_ENGINE),$(filter $(CONTAINER_ENGINE), docker podman))
			CONTAINER_PLATFORM:=linux/$(CONTAINER_PLATFORM)
		endif
	endif
endif

CONTAINER_PLATFORM_FLAG=
ifneq ($(CONTAINER_PLATFORM),)
	CONTAINER_PLATFORM_FLAG="--platform=$(CONTAINER_PLATFORM)"
endif

PLATFORM=$(shell echo ${CONTAINER_PLATFORM} | tr '/' '-')
ifneq ($(PLATFORM),)
	NOOBAA_RPM_TAG := "$(NOOBAA_RPM_TAG):$(PLATFORM)"
endif

GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell ${CONTAINER_ENGINE} ps -a | wc -l | xargs)"

UNAME_S?=$(shell uname -s)
ifeq ($(UNAME_S),Linux)
    ifeq ($(UID),0)
        HAVE_CPUSET ?= $(shell grep -c -w cpuset /sys/fs/cgroup/cgroup.controllers 2>/dev/null)
    else
        HAVE_CPUSET ?= $(shell grep -c -w cpuset /sys/fs/cgroup/user.slice/user-$(UID).slice/cgroup.controllers 2>/dev/null)
    endif
    ifeq ($(HAVE_CPUSET),1)
        CPUS?=$(shell nproc --ignore=1)
        CPUSET?=--cpuset-cpus=0-${CPUS}
    endif
endif

SUPPRESS_LOGS?=""
REDIRECT_STDOUT=
ifeq ($(SUPPRESS_LOGS), true)
	REDIRECT_STDOUT=1> /dev/null
endif

NO_CACHE?=""
CACHE_FLAG=
ifeq ($(NO_CACHE), true)
	CACHE_FLAG="--no-cache"
endif

USE_HOSTNETWORK?=""
NETWORK_FLAG=
ifeq ($(USE_HOSTNETWORK), true)
	NETWORK_FLAG="--network=host"
endif

# running blob mock on - all tests run OR on single test run of test_s3_ops.js
NAMESPACE_BLOB_TEST?="test_s3_ops.js"
RUN_BLOB_MOCK=true
ifdef testname
	ifneq ("$(testname)", $(NAMESPACE_BLOB_TEST))
		RUN_BLOB_MOCK=false
	endif
endif

BUILD_S3SELECT?=1
BUILD_S3SELECT_PARQUET?=0

## RPM VARIABLES 
DATE := $(shell date +'%Y%m%d')
NOOBAA_PKG_VERSION := $(shell jq -r '.version' < ./package.json)
RPM_BASE_VERSION := noobaa-core-$(NOOBAA_PKG_VERSION)-${DATE}
ifeq ($(CONTAINER_PLATFORM), linux/amd64)
  ARCH_SUFFIX := x86_64
else ifeq ($(CONTAINER_PLATFORM), linux/ppc64le)
  ARCH_SUFFIX := ppc64le
endif
RPM_FULL_PATH := $(RPM_BASE_VERSION).el${CENTOS_VER}.$(ARCH_SUFFIX).rpm
install_rpm_and_deps_command := dnf install -y make && rpm -i $(RPM_FULL_PATH) && systemctl enable noobaa --now && systemctl status noobaa && systemctl stop noobaa

###############
# BUILD LOCAL #
###############

default: build
.PHNOY: default

# this target builds incrementally
build:
	npm install
	npm run build
.PHONY: build

clean_build:
	npm run clean
.PHONY: clean_build

# this target cleans and rebuilds
rebuild: clean_build build
.PHONY: rebuild

pkg: build
	npm run pkg
.PHONY: pkg


################
# BUILD IMAGES #
################

assert-container-engine:
	@ if [ "${CONTAINER_ENGINE}" = "" ]; then \
		echo "\n  Error: You must have container engine installed\n"; \
		exit 1; \
	fi
.PHONY: assert-container-engine

all: tester noobaa
	@echo "\033[1;32mAll done.\033[0m"
.PHONY: all

builder: assert-container-engine
	@echo "\n##\033[1;32m Build image noobaa-builder ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) --build-arg CENTOS_VER=$(CENTOS_VER) --build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) --build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) -f src/deploy/NVA_build/builder.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-builder .
	$(CONTAINER_ENGINE) tag noobaa-builder $(BUILDER_TAG)
	@echo "##\033[1;32m Build image noobaa-builder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\n##\033[1;32m Build image noobaa-base ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) --build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) --build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) -f src/deploy/NVA_build/Base.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-base . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-base $(NOOBAA_BASE_TAG)
	@echo "##\033[1;32m Build image noobaa-base done.\033[0m"
.PHONY: base

noobaa: base
	@echo "\n##\033[1;32m Build image noobaa ...\033[0m"
	@echo "$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG)"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) --build-arg CENTOS_VER=$(CENTOS_VER) --build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) --build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) -f src/deploy/NVA_build/NooBaa.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa $(NOOBAA_TAG)
	@echo "##\033[1;32m Build image noobaa done.\033[0m"
.PHONY: noobaa

executable: base
	@echo "\n##\033[1;32m Build image noobaa-core-executable ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/standalone/executable.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-core-executable --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/standalone/export.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT) --output /tmp/noobaa-core-executable/
	@echo "##\033[1;32m Build image noobaa-core-executable done.\033[0m"
.PHONY: executable

# This rule builds a container image that includes developer tools
# which allows to build and debug the project.
nbdev:
	@echo "\n##\033[1;32m Build image nbdev ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/NVA_build/dev.Dockerfile $(CACHE_FLAG) -t nbdev --build-arg CENTOS_VER=$(CENTOS_VER) --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	@echo "##\033[1;32m Build image nbdev done.\033[0m"
	@echo ""
	@echo "Usage: docker run -it nbdev"
	@echo ""
.PHONY: nbdev

rpm: builder
	echo "\033[1;34mStarting RPM build for $${CONTAINER_PLATFORM}.\033[0m"
	mkdir -p build/rpm
	$(CONTAINER_ENGINE) rm -f noobaa-rpm-build-env
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/RPM_build/RPM.Dockerfile $(CACHE_FLAG) -t $(NOOBAA_RPM_TAG) --build-arg CENTOS_VER=$(CENTOS_VER) --build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) --build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) --build-arg SRPM_ONLY=$(SRPM_ONLY) --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	echo "\033[1;32mImage \"$(NOOBAA_RPM_TAG)\" is ready.\033[0m"
	echo "Generating RPM..."
	$(CONTAINER_ENGINE) run --name noobaa-rpm-build-env -t $(NOOBAA_RPM_TAG)
	mkdir -p $(PWD)/build/rpm && $(CONTAINER_ENGINE) cp noobaa-rpm-build-env:/export/. $(PWD)/build/rpm/
	$(CONTAINER_ENGINE) rm -f noobaa-rpm-build-env
	echo "\033[1;32mRPM for platform \"$(NOOBAA_RPM_TAG)\" is ready in build/rpm.\033[0m";
.PHONY: rpm

assert-rpm-build-and-install-test-platform:
	@ if [ "${CONTAINER_PLATFORM}" != "linux/amd64" ]; then \
		echo "\n  Error: Running rpm-build-and-install-test linux/amd64 is currently the only supported container platform\n"; \
		exit 1; \
	fi
.PHONY: assert-rpm-build-and-install-test-platform

rpm-build-and-install-test: assert-rpm-build-and-install-test-platform rpm
	@echo "Running RHEL linux/amd64 (currently only supported) container..."
	$(CONTAINER_ENGINE) run --name noobaa-rpm-build-and-install-test --privileged --user root -dit --platform=linux/amd64 redhat/ubi$(CENTOS_VER)-init
	@echo "Copying rpm_full_path=$(RPM_FULL_PATH) to the container..."
	$(CONTAINER_ENGINE) cp ./build/rpm/$(RPM_FULL_PATH) noobaa-rpm-build-and-install-test:$(RPM_FULL_PATH)
	@echo "Installing RPM and dependencies in the container... $(install_rpm_and_deps_command)"
	$(CONTAINER_ENGINE) exec noobaa-rpm-build-and-install-test bash -c "$(install_rpm_and_deps_command)"
.PHONY: rpm-build-and-install-test

###############
# TEST IMAGES #
###############

tester: noobaa
	@echo "\n##\033[1;32m Build image noobaa-tester ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/NVA_build/Tests.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-tester . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-tester $(TESTER_TAG)
	@echo "\033[1;32mTester done.\033[0m"
	@echo "##\033[1;32m Build image noobaa-tester done.\033[0m"
.PHONY: tester

build-ssl-postgres: tester
	@echo "\n##\033[1;32m Cretaing SSL CA for image ...\033[0m"
	mkdir -p -m 755 certs
	openssl ecparam -name prime256v1 -genkey -noout -out certs/ca.key
	openssl req -new -x509 -sha256 -key certs/ca.key -out certs/ca.crt -subj "/CN=ca.noobaa.com"
	@echo "\n##\033[1;32m Build image for SSL Postgres ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) --build-arg HOST=ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX) -f src/deploy/NVA_build/SSLPostgres.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t postgres:ssl . $(REDIRECT_STDOUT)
	@echo "\033[1;32mBuild SSL Postgres done.\033[0m"
	@echo "##\033[1;32m Build image postgres:ssl done.\033[0m"
.PHONY: build-ssl-postgres

build-aws-client: noobaa
	@echo "\n##\033[1;32m Build image for AWS Client tests ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) -f src/deploy/NVA_build/AWSClient.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-aws-client . $(REDIRECT_STDOUT)
	@echo "\033[1;32mBuild image for AWS Client tests done.\033[0m"
.PHONY: build-aws-client

test: tester
	@echo "\033[1;34mRunning tests with Mongo.\033[0m"
	@$(call create_docker_network)
	@$(call run_mongo)
	@$(call run_blob_mock)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "DB_TYPE=mongodb" --env "MONGODB_URL=mongodb://noobaa:noobaa@coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" $(TESTER_TAG)
	@$(call stop_noobaa)
	@$(call stop_blob_mock)
	@$(call stop_mongo)
	@$(call remove_docker_network)
.PHONY: test

root-perm-test: tester
	@echo "\033[1;34mRunning tests with Mongo with root permission.\033[0m"
	@$(call create_docker_network)
	@$(call run_mongo)
	@echo "\033[1;34mRunning root permission tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "DB_TYPE=mongodb" --env "MONGODB_URL=mongodb://noobaa:noobaa@coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)" $(TESTER_TAG) ./src/test/unit_tests/run_npm_test_on_test_container.sh -s sudo_index.js
	@$(call stop_noobaa)
	@$(call stop_mongo)
	@$(call remove_docker_network)
.PHONY: root-perm-test

run-single-test: tester
	@echo "\033[1;34mRunning single test with Mongo.\033[0m"
	@$(call create_docker_network)
	@$(call run_mongo)
	@$(call run_blob_mock)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "DB_TYPE=mongodb" --env "MONGODB_URL=mongodb://noobaa:noobaa@coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "NOOBAA_LOG_LEVEL=all" $(TESTER_TAG) ./src/test/unit_tests/run_npm_test_on_test_container.sh -s $(testname)
	@$(call stop_noobaa)
	@$(call stop_blob_mock)
	@$(call stop_mongo)
	@$(call remove_docker_network)
.PHONY: run-single-test

run-nc-tests: tester
	@$(call create_docker_network)
	@echo "\033[1;34mRunning nc tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "NC_CORETEST=true" $(TESTER_TAG) ./src/test/unit_tests/run_npm_test_on_test_container.sh -s nc_index.js
	@$(call stop_noobaa)
	@$(call remove_docker_network)
.PHONY: run-nc-tests

run-single-test-postgres: tester
	@echo "\033[1;34mRunning single test with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@$(call run_blob_mock)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "PG_ENABLE_QUERY_LOG=true" --env "PG_EXPLAIN_QUERIES=true" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" $(TESTER_TAG)  ./src/test/unit_tests/run_npm_test_on_test_container.sh -s $(testname)
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call stop_blob_mock)
	@$(call remove_docker_network)
.PHONY: run-single-test-postgres

test-postgres: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@$(call run_blob_mock)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" $(TESTER_TAG)
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call stop_blob_mock)
	@$(call remove_docker_network)
.PHONY: test-postgres

test-external-postgres: build-ssl-postgres
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_external_postgres)
	@$(call run_blob_mock)
	@$(call create_ssl_certs)
	@echo "\033[1;34mRunning tests on SSL PG(15)\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" \
	--env "POSTGRES_HOST=ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=postgres" --env "POSTGRES_DBNAME=coretest" \
	--env "NODE_EXTRA_CA_CERTS=/tmp/ca.crt" --env "POSTGRES_SSL_REQUIRED=true" --env "DB_TYPE=postgres" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" \
	-v $(PWD)/logs:/logs -v $(PWD)/certs:/etc/external-db-secret -v $(PWD)/certs/ca.crt:/tmp/ca.crt $(TESTER_TAG)
	@$(call stop_noobaa)
	@$(call stop_external_postgres)
	@$(call stop_blob_mock)
	@$(call remove_docker_network)
.PHONY: test-external-postgres

tests: test #alias for test
.PHONY: tests

test-cephs3: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/system_tests/ceph_s3_tests/run_ceph_test_on_test_container.sh"
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-cephs3

test-nsfs-cephs3: tester
	@echo "\033[1;34mRunning Ceph S3 tests on NSFS Standalone platform\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/system_tests/ceph_s3_tests/run_ceph_nsfs_test_on_test_container.sh"
.PHONY: test-nsfs-cephs3

test-sanity: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning sanity tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/system_tests/run_sanity_test_on_test_container.sh"
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-sanity

test-external-pg-sanity: build-ssl-postgres
	@echo "\033[1;34mRunning tests with External Postgres (v15).\033[0m"
	@$(call create_docker_network)
	@$(call run_external_postgres)
	@$(call create_ssl_certs)
	@echo "\033[1;34mRunning sanity tests on SSL PG(15)\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" \
	--env "POSTGRES_HOST=ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=postgres" --env "POSTGRES_DBNAME=postgres" \
	--env "NODE_EXTRA_CA_CERTS=/tmp/ca.crt" --env "POSTGRES_SSL_REQUIRED=true" --env "DB_TYPE=postgres" \
	-v $(PWD)/logs:/logs -v $(PWD)/certs:/etc/external-db-secret -v $(PWD)/certs/ca.crt:/tmp/ca.crt $(TESTER_TAG) \
	"./src/test/system_tests/run_sanity_test_on_test_container.sh"
	@$(call stop_noobaa)
	@$(call stop_external_postgres)
	@$(call remove_docker_network)
.PHONY: test-external-pg-sanity

test-aws-sdk-clients: build-aws-client
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning aws sdk clients tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" --env "NOOBAA_LOG_LEVEL=all" -v $(PWD)/logs:/logs  noobaa-aws-client ./src/test/unit_tests/run_npm_test_on_test_container.sh -c ./node_modules/mocha/bin/mocha.js src/test/unit_tests/different_clients/test_go_sdkv2_script.js
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-aws-sdk-clients

clean:
	@echo Stopping and Deleting containers
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) stop &> /dev/null
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) rm &> /dev/null
.PHONY: clean


######################
## HELPER FUNCTIONS ##
######################

##########
# NOOBAA #
##########

define stop_noobaa
	@echo "\033[1;34mStopping/removing test container\033[0m"
	$(CONTAINER_ENGINE) network disconnect noobaa-net noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) stop noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	@echo "\033[1;32mRemoving test container done.\033[0m"
endef

###########
# NETWORK #
###########

define create_docker_network
    @echo "\033[1;34mCreating docker network\033[0m"
	$(CONTAINER_ENGINE) network create noobaa-net || true
	@echo "\033[1;32mCreate docker network done.\033[0m"
endef

define remove_docker_network
    @echo "\033[1;34mRemove docker network\033[0m"
	$(CONTAINER_ENGINE) network rm noobaa-net
	@echo "\033[1;32mRemove docker network done.\033[0m"
endef

#########
# MONGO #
#########

define run_mongo
	@echo "\033[1;34mRunning Mongo container\033[0m"
	$(CONTAINER_ENGINE) run -d $(CPUSET) --network noobaa-net --name coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX) --env "MONGODB_ADMIN_PASSWORD=noobaa" --env "MONGODB_DATABASE=coretest" --env "MONGODB_USER=noobaa" --env "MONGODB_PASSWORD=noobaa" $(MONGO_IMAGE)
	@echo "\033[1;32mRun mongo done.\033[0m"
endef

define stop_mongo
	@echo "\033[1;34mStopping/removing Mongo container\033[0m"
	$(CONTAINER_ENGINE) network disconnect noobaa-net coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) stop coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm coretest-mongo-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@echo "\033[1;32mStop mongo done.\033[0m"
endef

############
# POSTGRES #
############

define run_postgres
	@echo "\033[1;34mRunning Postgres container\033[0m"
	$(CONTAINER_ENGINE) run -d $(CPUSET) --network noobaa-net --name coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX) --env "POSTGRESQL_DATABASE=coretest" --env "POSTGRESQL_USER=noobaa" --env "POSTGRESQL_PASSWORD=noobaa" --env "LC_COLLATE=C" $(POSTGRES_IMAGE)
	@echo "\033[1;34mWaiting for postgres to start..\033[0m"
	sleep 20
	@echo "\033[1;32mRun postgres done.\033[0m"
endef

define stop_postgres
	@echo "\033[1;34mStopping/removing Postgres container\033[0m"
	$(CONTAINER_ENGINE) network disconnect noobaa-net coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) stop coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@echo "\033[1;32mStop postgres done.\033[0m"
endef

#########################
# SSL EXTERNAL POSTGRES #
#########################

define run_external_postgres
	@echo "\033[1;34mRunning Postgres container\033[0m"
	$(CONTAINER_ENGINE) run -d $(CPUSET) --network noobaa-net --name ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX) --env "POSTGRES_PASSWORD=noobaa" --env "LC_COLLATE=C" -v $(PWD)/certs/ca.crt:/etc/ssl/certs/ca.crt postgres:ssl
	@echo "\033[1;34mWaiting for postgres to start..\033[0m"
	sleep 20
	@echo "\033[1;32mRun postgres done.\033[0m"
endef

define stop_external_postgres
	@echo "\033[1;34mStopping/removing Postgres container\033[0m"
	$(CONTAINER_ENGINE) network disconnect noobaa-net ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) stop ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@echo "\033[1;32mStop postgres done.\033[0m"
endef

define create_ssl_certs
	@echo "\033[1;34mCreating ssl client certificates for NooBaa container\033[0m"
	openssl ecparam -name prime256v1 -genkey -noout -out certs/tls.key
	openssl req -new -sha256 -key certs/tls.key -out certs/tls.csr -subj "/CN=postgres"
	openssl x509 -req -in certs/tls.csr -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial -out certs/tls.crt -days 365 -sha256
	chmod +r certs/tls.key
endef

#############
# BLOB MOCK #
#############

define run_blob_mock
    @echo "\033[1;34mStarting blob mock server if RUN_BLOB_MOCK=$(RUN_BLOB_MOCK) is true.\033[0m"
	@ if [ $(RUN_BLOB_MOCK) = true ]; then \
		echo "\033[1;34mRunning Blob mock.\033[0m"; \
		$(CONTAINER_ENGINE) run -p 10000:10000 -d --network noobaa-net --name blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX) mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0; \
	fi
	@echo "\033[1;32mBlob mock server done.\033[0m"
endef

define stop_blob_mock
    @echo "\033[1;34mStopping blob mock server if RUN_BLOB_MOCK=$(RUN_BLOB_MOCK) is true.\033[0m"
	@ if [ $(RUN_BLOB_MOCK) = true ]; then \
		echo "\033[1;34mStopping tests with Blob mock.\033[0m"; \
		$(CONTAINER_ENGINE) network disconnect noobaa-net blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX); \
		$(CONTAINER_ENGINE) stop blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX); \
		$(CONTAINER_ENGINE) rm blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX); \
	fi
	@echo "\033[1;32mBlob mock server stop done.\033[0m"
endef
