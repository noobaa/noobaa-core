BUILDER_TAG?="noobaa-builder"
NOOBAA_BASE_TAG?="noobaa-base"
NOOBAA_TAG?="noobaa"
TESTER_TAG?="noobaa-tester"
NOOBAA_RPM_TAG?="noobaa-rpm-build"
POSTGRES_IMAGE?="centos/postgresql-12-centos7"
CENTOS_VER?=9

#####################
# CONTAINER OPTIONS #
#####################

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
NAMESPACE_BLOB_TEST?="integration_tests/api/s3/test_s3_ops.js"
RUN_BLOB_MOCK=true
ifdef testpath
	ifneq ("$(testpath)", $(NAMESPACE_BLOB_TEST))
		RUN_BLOB_MOCK=false
	endif
endif

#################
# BUILD OPTIONS #
#################

# optional S3SELECT support with/out PARQUET
BUILD_S3SELECT?=1
BUILD_S3SELECT_PARQUET?=0

# optional RDMA support with CUOBJ
USE_CUOBJ_SERVER?=0
USE_CUOBJ_CLIENT?=0

# optional CUDA support
USE_CUDA?=0

# By default do not link with the libraries on build time -
# linking will be done dynamically at runtime (LD_PRELOAD or dlopen).
# set to 1 to link with the libraries on build time.
USE_CUOBJ_LIBS?=0
USE_CUDA_LIBS?=0

# USE_RDMA is derived from USE_CUOBJ_SERVER or USE_CUOBJ_CLIENT
USE_RDMA=$(or $(filter 1,$(USE_CUOBJ_SERVER)),$(filter 1,$(USE_CUOBJ_CLIENT)),0)
ifeq ($(USE_RDMA),1)
	CUOBJ_INC_PATH?=/opt/cuObject/src/include
	CUOBJ_LIB_PATH?=/opt/cuObject/src/lib
endif

# use dummy dirs for docker context because it requires an existing path
CUOBJ_INC_CTX=$(if $(CUOBJ_INC_PATH),$(CUOBJ_INC_PATH),/tmp/noobaa_dummy_cuobj_inc_ctx)
CUOBJ_LIB_CTX=$(if $(CUOBJ_LIB_PATH),$(CUOBJ_LIB_PATH),/tmp/noobaa_dummy_cuobj_lib_ctx)

ifeq ($(USE_CUDA),1)
	CUDA_PATH?=/usr/local/cuda
	BUILDER_BASE_IMAGE?=nvcr.io/nvidia/cuda:13.1.0-devel-ubi$(CENTOS_VER)
else
	BUILDER_BASE_IMAGE?=quay.io/centos/centos:stream$(CENTOS_VER)
endif

# GYP_DEFINES is used to pass build variables to npm gyp builds
GYP_DEFINES?=\
	BUILD_S3SELECT=$(BUILD_S3SELECT) \
	BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) \
	USE_CUOBJ_SERVER=$(USE_CUOBJ_SERVER) \
	USE_CUOBJ_CLIENT=$(USE_CUOBJ_CLIENT) \
	USE_CUOBJ_LIBS=$(USE_CUOBJ_LIBS) \
	USE_CUDA_LIBS=$(USE_CUDA_LIBS) \
	USE_CUDA=$(USE_CUDA) \
	USE_RDMA=$(USE_RDMA) \
	$(if $(CUOBJ_INC_PATH),CUOBJ_INC_PATH=$(CUOBJ_INC_PATH),) \
	$(if $(CUOBJ_LIB_PATH),CUOBJ_LIB_PATH=$(CUOBJ_LIB_PATH),) \
	$(if $(CUDA_PATH),CUDA_PATH=$(CUDA_PATH),)

#################
# RPM VARIABLES #
#################

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

################## 
# MINT VARIABLES #
##################

MINT_MOCK_ACCESS_KEY="aaaaaaaaaaaaaEXAMPLE"
MINT_MOCK_SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaEXAMPLE"
MINT_NOOBAA_HTTP_ENDPOINT_PORT=6001

###############
# BUILD LOCAL #
###############

default: build
.PHONY: default

# this target builds incrementally
build:
	npm install
	GYP_DEFINES='$(GYP_DEFINES)' npm run build --verbose
.PHONY: build

clean:
	npm run clean
.PHONY: clean

# this target cleans and rebuilds
rebuild: clean build
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
	mkdir -p $(CUOBJ_INC_CTX) 
	mkdir -p $(CUOBJ_LIB_CTX)
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/NVA_build/builder.Dockerfile  \
		-t noobaa-builder \
		--build-arg CENTOS_VER=$(CENTOS_VER) \
		--build-arg BUILDER_BASE_IMAGE=$(BUILDER_BASE_IMAGE) \
		--build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) \
		--build-arg USE_RDMA=$(USE_RDMA) \
		--build-arg CUOBJ_INC_PATH=$(CUOBJ_INC_PATH) \
		--build-arg CUOBJ_LIB_PATH=$(CUOBJ_LIB_PATH) \
		--build-context cuobj_inc=$(CUOBJ_INC_CTX) \
		--build-context cuobj_lib=$(CUOBJ_LIB_CTX) \
		. $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-builder $(BUILDER_TAG)
	@echo "##\033[1;32m Build image noobaa-builder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\n##\033[1;32m Build image noobaa-base ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/NVA_build/Base.Dockerfile \
		-t noobaa-base \
		--build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) \
		--build-arg GYP_DEFINES='$(GYP_DEFINES)' \
		. $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-base $(NOOBAA_BASE_TAG)
	@echo "##\033[1;32m Build image noobaa-base done.\033[0m"
.PHONY: base

noobaa: base
	@echo "\n##\033[1;32m Build image noobaa ...\033[0m"
	@echo "$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG)"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/NVA_build/NooBaa.Dockerfile \
		-t noobaa \
		--build-arg CENTOS_VER=$(CENTOS_VER) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg BUILD_S3SELECT_PARQUET=$(BUILD_S3SELECT_PARQUET) \
		. $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa $(NOOBAA_TAG)
	@echo "##\033[1;32m Build image noobaa done.\033[0m"
.PHONY: noobaa

#######
# RPM #
#######

rpm: builder
	@echo "\033[1;34mStarting RPM build for $${CONTAINER_PLATFORM}.\033[0m"
	mkdir -p build/rpm
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/RPM_build/RPM.Dockerfile \
		--build-arg CENTOS_VER=$(CENTOS_VER) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg SRPM_ONLY=$(SRPM_ONLY) \
		--build-arg BUILD_S3SELECT=$(BUILD_S3SELECT) \
		--build-arg USE_RDMA=$(USE_RDMA) \
		--build-arg GYP_DEFINES='$(GYP_DEFINES)' \
		--output ./build/rpm/ \
		. $(REDIRECT_STDOUT)
	@echo "\033[1;32mRPM for platform \"$(NOOBAA_RPM_TAG)\" is ready in ./build/rpm/\033[0m";
.PHONY: rpm

assert-rpm-build-and-install-test-platform:
	@ if [ "$(CONTAINER_PLATFORM)" != "linux/amd64" ]; then \
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

##############
# DEV IMAGES #
##############

executable: base
	@echo "\n##\033[1;32m Build image noobaa-core-executable ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/standalone/executable.Dockerfile \
		-t noobaa-core-executable \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		. $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/standalone/export.Dockerfile \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		. $(REDIRECT_STDOUT) \
		--output /tmp/noobaa-core-executable/
	@echo "##\033[1;32m Build image noobaa-core-executable done.\033[0m"
.PHONY: executable

# This rule builds a container image that includes developer tools
# which allows to build and debug the project.
nbdev:
	@echo "\n##\033[1;32m Build image nbdev ...\033[0m"
	$(CONTAINER_ENGINE) build $(CONTAINER_PLATFORM_FLAG) $(CPUSET) $(CACHE_FLAG) $(NETWORK_FLAG) \
		-f src/deploy/NVA_build/dev.Dockerfile \
		-t nbdev \
		--build-arg CENTOS_VER=$(CENTOS_VER) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		. $(REDIRECT_STDOUT)
	@echo "##\033[1;32m Build image nbdev done.\033[0m"
	@echo ""
	@echo "Usage: docker run -it nbdev"
	@echo ""
.PHONY: nbdev


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

test: test-postgres
.PHONY: test

root-perm-test: tester
	@echo "\033[1;34mRunning tests with Postgres with root permission.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning root permission tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" $(TESTER_TAG) ./src/test/framework/run_npm_test_on_test_container.sh -s utils/index/sudo_index.js
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: root-perm-test

run-single-test: run-single-test-postgres
.PHONY: run-single-test

run-nc-tests: tester
	@$(call create_docker_network)
	@echo "\033[1;34mRunning nc tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "NC_CORETEST=true" $(TESTER_TAG) ./src/test/framework/run_npm_test_on_test_container.sh -s utils/index/nc_index.js
	@$(call stop_noobaa)
	@$(call remove_docker_network)
.PHONY: run-nc-tests

run-single-test-postgres: tester
	@echo "\033[1;34mRunning single test with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@$(call run_blob_mock)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "PG_ENABLE_QUERY_LOG=true" --env "PG_EXPLAIN_QUERIES=true" --env "BLOB_HOST=blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)" $(TESTER_TAG)  ./src/test/framework/run_npm_test_on_test_container.sh -s $(testpath)
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

tests: test-postgres
.PHONY: tests

test-cephs3: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/external_tests/ceph_s3_tests/run_ceph_test_on_test_container.sh"
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-cephs3

test-warp: tester
	@echo "\033[1;34mRunning warp tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning warp tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --privileged --user root --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs:/logs $(TESTER_TAG) bash -c "./src/test/external_tests/warp/run_warp_on_test_container.sh $(WARP_ARGS)"
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-warp

test-nc-warp: tester
	@echo "\033[1;34mRunning warp tests on NC environment\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" -v $(PWD)/logs:/logs $(TESTER_TAG) bash -c "./src/test/external_tests/warp/run_nc_warp_on_test_container.sh $(WARP_ARGS)"
.PHONY: test-nc-warp

test-mint: tester
	@echo "\033[1;34mRunning mint tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning mint tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) -dit --network noobaa-net --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs/mint-test-logs/:/logs $(TESTER_TAG) bash -c "./src/test/external_tests/mint/run_mint_on_test_container.sh & tail -f /dev/null" 
	sleep 180
	$(CONTAINER_ENGINE) run --name mint-$(GIT_COMMIT)-$(NAME_POSTFIX) --network noobaa-net -v $(PWD)/logs/mint-test-logs/:/mint/log --env SERVER_ENDPOINT=noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX):$(MINT_NOOBAA_HTTP_ENDPOINT_PORT) --env ACCESS_KEY=$(MINT_MOCK_ACCESS_KEY) --env SECRET_KEY=$(MINT_MOCK_SECRET_KEY) --env ENABLE_HTTPS=0 minio/mint minio-go s3cmd
	@echo "\033[1;34mPrinting noobaa configuration and logs\033[0m"
	$(CONTAINER_ENGINE) logs noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	@echo "\033[1;34mPrinting mint results file\033[0m"
	cat $(PWD)/logs/mint-test-logs/log.json
	@$(call disconnect_container_from_noobaa_network, mint-$(GIT_COMMIT)-$(NAME_POSTFIX))
	$(CONTAINER_ENGINE) rm mint-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-mint


test-nc-mint: tester
	@echo "\033[1;34mRunning mint tests on NC environment\033[0m"
	@$(call create_docker_network)
	$(CONTAINER_ENGINE) run $(CPUSET) --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) -dit --privileged --user root --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --network noobaa-net -v $(PWD)/logs/mint-nc-test-logs/:/logs $(TESTER_TAG) bash -c "./src/test/external_tests/mint/run_nc_mint_on_test_container.sh; tail -f /dev/null"
	sleep 15
	$(CONTAINER_ENGINE) run --name mint-$(GIT_COMMIT)-$(NAME_POSTFIX) --network noobaa-net -v $(PWD)/logs/mint-nc-test-logs/:/mint/log --env RUN_ON_FAIL=0 --env SERVER_ENDPOINT=noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX):$(MINT_NOOBAA_HTTP_ENDPOINT_PORT) --env ACCESS_KEY=$(MINT_MOCK_ACCESS_KEY) --env SECRET_KEY=$(MINT_MOCK_SECRET_KEY) --env ENABLE_HTTPS=0 minio/mint minio-go s3cmd
	@echo "\033[1;34mPrinting noobaa configuration and logs\033[0m"
	$(CONTAINER_ENGINE) logs noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	@echo "\033[1;34mPrinting mint results file\033[0m"
	cat $(PWD)/logs/mint-nc-test-logs/log.json
	@$(call disconnect_container_from_noobaa_network, mint-$(GIT_COMMIT)-$(NAME_POSTFIX))
	$(CONTAINER_ENGINE) rm mint-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@$(call stop_noobaa)
	@$(call remove_docker_network)
.PHONY: test-nc-mint

test-s3a: tester
	@echo "\033[1;34mRunning Hadoop S3A tests with Postgres.\033[0m"
	@$(call create_docker_network)
	@$(call run_postgres)
	@echo "\033[1;34mRunning Hadoop S3A tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/external_tests/s3a/run_s3a_on_test_container.sh"
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-s3a

test-nsfs-cephs3: tester
	@echo "\033[1;34mRunning Ceph S3 tests on NSFS Standalone platform\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --privileged --user root --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" -v $(PWD)/logs:/logs $(TESTER_TAG) "./src/test/external_tests/ceph_s3_tests/run_ceph_nsfs_test_on_test_container.sh"
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
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "POSTGRES_DBNAME=coretest" --env "NOOBAA_LOG_LEVEL=all" -v $(PWD)/logs:/logs  noobaa-aws-client ./src/test/framework/run_npm_test_on_test_container.sh -c ./node_modules/mocha/bin/mocha.js src/test/external_tests/different_clients/test_go_sdkv2_script.js
	@$(call stop_noobaa)
	@$(call stop_postgres)
	@$(call remove_docker_network)
.PHONY: test-aws-sdk-clients

clean-containers:
	@echo Stopping and Deleting containers
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) stop &> /dev/null
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) rm &> /dev/null
.PHONY: clean-containers


######################
## HELPER FUNCTIONS ##
######################

##########
# NOOBAA #
##########

define stop_noobaa
	@echo "\033[1;34mStopping/removing test container\033[0m"
	$(call disconnect_container_from_noobaa_network, noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX))
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

define disconnect_container_from_noobaa_network
	echo "\033[1;34mDisconnect container $(1) from noobaa network\033[0m"; \
	$(CONTAINER_ENGINE) network disconnect noobaa-net $(1); \
	echo "\033[1;34mDisconnect container $(1) from noobaa network done.\033[0m" 
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
	$(call disconnect_container_from_noobaa_network, coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX))
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
	$(call disconnect_container_from_noobaa_network, ssl-pg-$(GIT_COMMIT)-$(NAME_POSTFIX))
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
		$(call disconnect_container_from_noobaa_network, blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX)); \
		$(CONTAINER_ENGINE) stop blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX); \
		$(CONTAINER_ENGINE) rm blob-mock-$(GIT_COMMIT)-$(NAME_POSTFIX); \
	fi
	@echo "\033[1;32mBlob mock server stop done.\033[0m"
endef
