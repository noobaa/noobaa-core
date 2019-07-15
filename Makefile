GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell docker ps -a | wc -l | xargs)"
BUILDER_TAG?="noobaa-builder"
TESTER_TAG?="noobaa-tester"
NOOBAA_TAG?="noobaa"
NOOBAA_BASE_TAG?="noobaa-base"
SUPPRESS_LOGS?=""
export

all: tester noobaa
	@echo "\033[1;34mAll done.\033[0m"
.PHONY: all

builder:
	@echo "\033[1;34mStarting Builder docker build.\033[0m"
ifeq ($(SUPPRESS_LOGS), true)
	docker build -f src/deploy/NVA_build/builder.Dockerfile --no-cache -t $(BUILDER_TAG) . 1> /dev/null
else
	docker build -f src/deploy/NVA_build/builder.Dockerfile -t $(BUILDER_TAG) .
endif
	@echo "\033[1;34mBuilder done.\033[0m"
.PHONY: builder

base: builder
	@echo "\033[1;34mStarting Base docker build.\033[0m"
ifeq ($(SUPPRESS_LOGS), true)
	docker build -f src/deploy/NVA_build/Base.Dockerfile --no-cache -t $(NOOBAA_BASE_TAG) . 1> /dev/null
else
	docker build -f src/deploy/NVA_build/Base.Dockerfile -t $(NOOBAA_BASE_TAG) .
endif
	@echo "\033[1;34mBase done.\033[0m"
.PHONY: base

tester: base noobaa
	@echo "\033[1;34mStarting Tester docker build.\033[0m"
ifeq ($(SUPPRESS_LOGS), true)
	docker build -f src/deploy/NVA_build/Tests.Dockerfile --no-cache -t $(TESTER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) . 1> /dev/null
else
	docker build -f src/deploy/NVA_build/Tests.Dockerfile -t $(TESTER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
endif
	@echo "\033[1;34mTester done.\033[0m"
.PHONY: tester

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	docker run --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTER_TAG) 
.PHONY: test

tests: test #alias for test
.PHONY: tests

noobaa: base
	@echo "\033[1;34mStarting NooBaa docker build.\033[0m"
	docker build -f src/deploy/NVA_build/NooBaa.Dockerfile -t $(NOOBAA_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mNooBaa done.\033[0m"
.PHONY: noobaa

clean:
	@echo Stopping and Deleting containers
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker stop
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker rm
.PHONY: clean
