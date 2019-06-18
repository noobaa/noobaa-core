GIT_COMMIT?="$(shell git rev-parse HEAD | head -c 7)"
TESTSER_TAG?="noobaa/tester"
SERVER_TAG?="noobaa/server"
AGENT_TAG?="noobaa/agent"
export

all: builder tester server agent
	@echo "\033[1;34mAll done.\033[0m"

builder:
	@echo "\033[1;34mStarting Builder docker build.\033[0m"
	docker build -f src/deploy/NVA_build/builder.Dockerfile -t noobaa/builder .
	@echo "\033[1;34mBuilder done.\033[0m"

tester: builder
	@echo "\033[1;34mStarting Testser docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Tests.Dockerfile -t $(TESTSER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mTester done.\033[0m"

test: tester
	@echo "\033[1;34mRunning tests.\033[0m"
	docker run $(TESTSER_TAG)

server: builder
	@echo "\033[1;34mStarting Server docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Server.Dockerfile -t $(SERVER_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mServer done.\033[0m"

agent: builder
	@echo "\033[1;34mStarting Agent docker build.\033[0m"
	docker build -f src/deploy/NVA_build/Agent.Dockerfile -t $(AGENT_TAG) --build-arg GIT_COMMIT=$(GIT_COMMIT) .
	@echo "\033[1;34mAgent done.\033[0m"

clean:
	@echo TODO clean
