WORKDIR ?= $(CURDIR)/../
OUTPUT ?= $(WORKDIR)/_output/

.PHONY: test deploy

test:
	cd $(WORKDIR) && jenkins-jobs test -o $(OUTPUT) jobs

deploy:
	cd $(WORKDIR) && jenkins-jobs update --delete-old jobs
