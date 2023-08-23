CONTAINER_ENGINE?=$(shell docker version >/dev/null 2>&1 && echo docker)
ifeq ($(CONTAINER_ENGINE),)
	CONTAINER_ENGINE=$(shell podman version >/dev/null 2>&1 && echo podman)
endif

GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell ${CONTAINER_ENGINE} ps -a | wc -l | xargs)"
BUILDER_TAG?="noobaa-builder"
TESTER_TAG?="noobaa-tester"
POSTGRES_IMAGE?="centos/postgresql-12-centos7"
NOOBAA_TAG?="noobaa"
NOOBAA_BASE_TAG?="noobaa-base"
SUPPRESS_LOGS?=""
NO_CACHE?=""
USE_HOSTNETWORK?=""
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
REDIRECT_STDOUT=
ifeq ($(SUPPRESS_LOGS), true)
	REDIRECT_STDOUT=1> /dev/null
endif

CACHE_FLAG=
ifeq ($(NO_CACHE), true)
	CACHE_FLAG="--no-cache"
endif

NETWORK_FLAG=
ifeq ($(USE_HOSTNETWORK), true)
	NETWORK_FLAG="--network=host"
endif

export

assert-container-engine:
	@ if [ "${CONTAINER_ENGINE}" = "" ]; then \
		echo "\n  Error: You must have container engine installed\n"; \
		exit 1; \
	fi

all: tester noobaa
	@echo "\033[1;32mAll done.\033[0m"
.PHONY: all

builder: assert-container-engine
	@echo "\033[1;34mStarting Builder $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/builder.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-builder .
	$(CONTAINER_ENGINE) tag noobaa-builder $(BUILDER_TAG)
	@echo "\033[1;32mBuilder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\033[1;34mStarting Base $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/Base.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-base . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-base $(NOOBAA_BASE_TAG)
	@echo "\033[1;32mBase done.\033[0m"
.PHONY: base

tester: noobaa
	@echo "\033[1;34mStarting Tester $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/Tests.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa-tester . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-tester $(TESTER_TAG)
	@echo "\033[1;32mTester done.\033[0m"
.PHONY: tester

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTER_TAG) 
.PHONY: test

run-single-test: tester
	@echo "\033[1;34mRunning single test.\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTER_TAG) ./src/test/unit_tests/run_npm_test_on_test_container.sh -s $(testname)
.PHONY: run-single-test


run-single-test-postgres: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@echo "\033[1;34mCreating docker network\033[0m"
	$(CONTAINER_ENGINE) network create noobaa-net || true
	@echo "\033[1;34mRunning Postgres container\033[0m"
	$(CONTAINER_ENGINE) run -d $(CPUSET) --network noobaa-net --name coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX) --env "POSTGRESQL_DATABASE=coretest" --env "POSTGRESQL_USER=noobaa" --env "POSTGRESQL_PASSWORD=noobaa" --env "LC_COLLATE=C" $(POSTGRES_IMAGE)
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" --env "PG_ENABLE_QUERY_LOG=true" --env "PG_EXPLAIN_QUERIES=true" $(TESTER_TAG) ./src/test/unit_tests/run_npm_test_on_test_container.sh -s $(testname)
	@echo "\033[1;34mStopping/removing test container\033[0m"
	$(CONTAINER_ENGINE) stop noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	@echo "\033[1;34mStopping/removing Postgres container\033[0m"
	$(CONTAINER_ENGINE) stop coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@echo "\033[1;34mRemove docker network\033[0m"
	$(CONTAINER_ENGINE) network rm noobaa-net

test-postgres: tester
	@echo "\033[1;34mRunning tests with Postgres.\033[0m"
	@echo "\033[1;34mCreating docker network\033[0m"
	$(CONTAINER_ENGINE) network create noobaa-net || true
	@echo "\033[1;34mRunning Postgres container\033[0m"
	$(CONTAINER_ENGINE) run -d $(CPUSET) --network noobaa-net --name coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX) --env "POSTGRESQL_DATABASE=coretest" --env "POSTGRESQL_USER=noobaa" --env "POSTGRESQL_PASSWORD=noobaa" --env "LC_COLLATE=C" $(POSTGRES_IMAGE) 
	@echo "\033[1;34mRunning tests\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --network noobaa-net --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" --env "POSTGRES_HOST=coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)" --env "POSTGRES_USER=noobaa" --env "DB_TYPE=postgres" $(TESTER_TAG)
	@echo "\033[1;34mStopping/removing test container\033[0m"
	$(CONTAINER_ENGINE) stop noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX)
	@echo "\033[1;34mStopping/removing Postgres container\033[0m"
	$(CONTAINER_ENGINE) stop coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	$(CONTAINER_ENGINE) rm coretest-postgres-$(GIT_COMMIT)-$(NAME_POSTFIX)
	@echo "\033[1;34mRemove docker network\033[0m"
	$(CONTAINER_ENGINE) network rm noobaa-net

.PHONY: test-postgres

tests: test #alias for test
.PHONY: tests

noobaa: base
	@echo "\033[1;34mStarting NooBaa $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/NooBaa.Dockerfile $(CACHE_FLAG) $(NETWORK_FLAG) -t noobaa --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa $(NOOBAA_TAG)
	@echo "\033[1;32mNooBaa done.\033[0m"
.PHONY: noobaa

# This rule builds a container image that includes developer tools
# which allows to build and debug the project.
nbdev:
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/dev.Dockerfile $(CACHE_FLAG) -t nbdev --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	@echo "\033[1;32mImage 'nbdev' is ready.\033[0m"
	@echo "Usage: docker run -it nbdev"
.PHONY: nbdev

clean:
	@echo Stopping and Deleting containers
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) stop &> /dev/null
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) rm &> /dev/null
.PHONY: clean
