CONTAINER_ENGINE?=$(shell docker version >/dev/null 2>&1 && echo docker)
ifeq ($(CONTAINER_ENGINE),)
	CONTAINER_ENGINE=$(shell podman version >/dev/null 2>&1 && echo podman)
endif

GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell ${CONTAINER_ENGINE} ps -a | wc -l | xargs)"
BUILDER_TAG?="noobaa-builder"
TESTER_TAG?="noobaa-tester"
NOOBAA_TAG?="noobaa"
NOOBAA_BASE_TAG?="noobaa-base"
SUPPRESS_LOGS?=""
NO_CACHE?=""
UNAME_S?=$(shell uname -s)
ifeq ($(UNAME_S),Linux)
    CPUS?=$(shell nproc --ignore=1)
    CPUSET?=--cpuset-cpus=0-${CPUS}
endif
REDIRECT_STDOUT=
ifeq ($(SUPPRESS_LOGS), true)
	REDIRECT_STDOUT=1> /dev/null
endif

CACHE_FLAG=
ifeq ($(NO_CACHE), true)
	CACHE_FLAG="--no-cache"
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
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/builder.Dockerfile $(CACHE_FLAG) -t noobaa-builder .
	$(CONTAINER_ENGINE) tag noobaa-builder $(BUILDER_TAG)
	@echo "\033[1;32mBuilder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\033[1;34mStarting Base $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/Base.Dockerfile $(CACHE_FLAG) -t noobaa-base . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-base $(NOOBAA_BASE_TAG)
	@echo "\033[1;32mBase done.\033[0m"
.PHONY: base

tester: base noobaa
	@echo "\033[1;34mStarting Tester $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/Tests.Dockerfile $(CACHE_FLAG) -t noobaa-tester . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa-tester $(TESTER_TAG)
	@echo "\033[1;32mTester done.\033[0m"
.PHONY: tester

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	$(CONTAINER_ENGINE) run $(CPUSET) --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTER_TAG) 
.PHONY: test

tests: test #alias for test
.PHONY: tests

noobaa: base
	@echo "\033[1;34mStarting NooBaa $(CONTAINER_ENGINE) build.\033[0m"
	$(CONTAINER_ENGINE) build $(CPUSET) -f src/deploy/NVA_build/NooBaa.Dockerfile $(CACHE_FLAG) -t noobaa --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	$(CONTAINER_ENGINE) tag noobaa $(NOOBAA_TAG)
	@echo "\033[1;32mNooBaa done.\033[0m"
.PHONY: noobaa

clean:
	@echo Stopping and Deleting containers
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) stop &> /dev/null
	@$(CONTAINER_ENGINE) ps -a | grep noobaa_ | awk '{print $1}' | xargs $(CONTAINER_ENGINE) rm &> /dev/null
.PHONY: clean
