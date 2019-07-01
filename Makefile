GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
NAME_POSTFIX?="$(shell docker ps -a | wc -l | xargs)"
TESTSER_TAG?="noobaa-tester"
SERVER_TAG?="noobaa-server"
AGENT_TAG?="noobaa-agent"
SUPPRESS_LOGS?=""
export

all: builder tester server agent
	@echo "\033[1;34mAll done.\033[0m"

builder:
	@echo "\033[1;34mStarting Builder docker build.\033[0m"
ifeq ($(SUPPRESS_LOGS), true)
	docker build -f src/deploy/NVA_build/builder.Dockerfile --no-cache -t noobaa/builder . 1> /dev/null
else
	docker build -f src/deploy/NVA_build/builder.Dockerfile -t noobaa/builder .
endif
	@echo "\033[1;34mBuilder done.\033[0m"

tester: builder
	@echo "\033[1;34mStarting Testser docker build.\033[0m"
ifeq ($(SUPPRESS_LOGS), true)
	docker build -f src/deploy/NVA_build/Tests.Dockerfile --no-cache -t $(TESTSER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) . 1> /dev/null
else
	docker build -f src/deploy/NVA_build/Tests.Dockerfile -t $(TESTSER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
endif
	@echo "\033[1;34mTester done.\033[0m"

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	docker run --name noobaa_$(GIT_COMMIT)_$(NAME_POSTFIX) --env "SUPPRESS_LOGS=$(SUPPRESS_LOGS)" $(TESTSER_TAG) 

tests: test #alias for test

server: builder
	@echo "\033[1;34mStarting Server docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Server.Dockerfile -t $(SERVER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mServer done.\033[0m"

agent: builder
	@echo "\033[1;34mStarting Agent docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Agent.Dockerfile -t $(AGENT_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mAgent done.\033[0m"

clean:
	@echo Stopping and Deleting containers
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker stop
	@docker ps -a | grep noobaa_ | awk '{print $$NF}' | xargs docker rm

