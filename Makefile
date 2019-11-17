GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell docker ps -a | wc -l | xargs)"
BUILDER_TAG?="noobaa-builder"
TESTER_TAG?="noobaa-tester"
NOOBAA_TAG?="noobaa"
NOOBAA_BASE_TAG?="noobaa-base"
SUPPRESS_LOGS?=""
NO_CACHE?=""

REDIRECT_STDOUT=
ifeq ($(SUPPRESS_LOGS), true)
	REDIRECT_STDOUT=1> /dev/null
endif

CACHE_FLAG=
ifeq ($(NO_CACHE), true)
	CACHE_FLAG="--no-cache"
endif

export

all: tester noobaa
	@echo "\033[1;32mAll done.\033[0m"
.PHONY: all

builder:
	@echo "\033[1;34mStarting Builder docker build.\033[0m"
	docker build -f src/deploy/NVA_build/builder.Dockerfile $(CACHE_FLAG) -t noobaa-builder . $(REDIRECT_STDOUT)
	docker tag noobaa-builder $(BUILDER_TAG)
	@echo "\033[1;32mBuilder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\033[1;34mStarting Base docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Base.Dockerfile $(CACHE_FLAG) -t noobaa-base . $(REDIRECT_STDOUT)
	docker tag noobaa-base $(NOOBAA_BASE_TAG)
	@echo "\033[1;32mBase done.\033[0m"
.PHONY: base

tester: base noobaa
	@echo "\033[1;34mStarting Tester docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Tests.Dockerfile $(CACHE_FLAG) -t noobaa-tester . $(REDIRECT_STDOUT)
	docker tag noobaa-tester $(TESTER_TAG)
	@echo "\033[1;32mTester done.\033[0m"
.PHONY: tester

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	docker run --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTER_TAG) 
.PHONY: test

tests: test #alias for test
.PHONY: tests

noobaa: base
	@echo "\033[1;34mStarting NooBaa docker build.\033[0m"
	docker build -f src/deploy/NVA_build/NooBaa.Dockerfile $(CACHE_FLAG) -t noobaa --build-arg GIT_COMMIT=$(GIT_COMMIT) . $(REDIRECT_STDOUT)
	docker tag noobaa $(NOOBAA_TAG)
	@echo "\033[1;32mNooBaa done.\033[0m"
.PHONY: noobaa

clean:
	@echo Stopping and Deleting containers
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker stop
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker rm
.PHONY: clean
