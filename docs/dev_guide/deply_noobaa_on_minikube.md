# Deploy Noobaa On Minikube Guide
We will run the commands in the terminal, you may work with at least two tabs:
1) For noobaa-core repository
2) For noobaa-operator repository
In each step, it is mentioned what tab you should use.

## Configuration (First Time Only):

### 1) Change Your Docker Resource Preferences:
1) Click on docker logo -> preference… -> Resource (left choice in the menu: CPU: 6, Memory: 10 GB, SWAP: 1 GB, Disk: 80 GB

### 2) Setting Your Minikube Configurations
1) Install [minikube](https://minikube.sigs.k8s.io/docs/start/).
2) Start your cluster
```bash
minikube start
```
3) Set configurations:
```bash
    minikube config set memory 8000
    minikube config set cpus 5
```

## Instruction (Every time you open a tab):
### 1) Check That Minikube Is Running
```bash
minikube status
```

### 2) Before Building The Images (Noobaa-Core Tab)
Change the working directory to the local repository (in this example the local repository is inside `SourceCode` directory).
```bash
 cd ./SourceCode/noobaa-core
```
We will use minikube to run the tests. It is recommended to build all images on the minikube docker daemon. Configure your docker client to use minikube's docker run:
```bash
eval $(minikube docker-env)
```
### 3) Before Building The Images (Noobaa-Operator Tab)
Change the working directory to the local repository (in this example the local repository is inside `SourceCode` directory).
```bash
 cd ./SourceCode/noobaa-operator
```
In order to build the CLI and the operator image run the following:
```bash
. ./devenv.sh
```
_Note: the file `devenv.sh` contains the command `eval $(minikube docker-env)`. We run the command `eval $(minikube docker-env)` prior to an image build (whether from noobaa core repository or noobaa operator repository)._
### 4) Build Operator Images (Noobaa-Operator Tab)
```bash
make all
```
This will build the following:
* noobaa-operator image with tag `noobaa/noobaa-operator:<major.minor.patch>` (for example: `noobaa/noobaa-operator:5.13.0`). this tag is used by default when installing with the CLI.
* noobaa CLI. The `devenv.sh` script is setting an alias `nb` to run the local build of the CLI.

### 5) Build Core Images (Noobaa-Core Tab)
Run the following to build noobaa core image with the desired tag to build the tester image:
```bash
make noobaa
```
Change the tag name  `noobaa:latest noobaa-core:<tag-name>`, for example: 
```bash
docker tag noobaa:latest noobaa-core:my-deploy
```
### 6) Deploy Noobaa (Noobaa-Operator Tab)
```bash
nb install --mini --noobaa-image='noobaa-core:my-deploy'
```
_Note: We have the alias to `nb` from the step 'Build Operator'._

The installation should take 5-10 minutes.
Once noobaa is installed please notice that the phase is Ready, you will see it in the CLI logs:

✅ System Phase is "Ready".

You can see something similar to this when getting the pods:
```
> kubectl get pods
NAME                                               READY   STATUS    RESTARTS   AGE
noobaa-core-0                                      1/1     Running   0          51m
noobaa-db-pg-0                                     1/1     Running   0          51m
noobaa-default-backing-store-noobaa-pod-a586c55b   1/1     Running   0          47m
noobaa-endpoint-6cf5cccfc6-rmdrd                   1/1     Running   0          47m
noobaa-operator-5c959d5564-qzgqb                   1/1     Running   0          51m
```

### 7) Wait For Default Backingstore to Be Ready (Noobaa-Operator Tab)
We will use the default backingstore pod to run the tests, we need it to be in phase Ready, run:
```bash
kubectl wait --for=condition=available backingstore/noobaa-default-backing-store --timeout=6m
```
## Workarounds:
### 1) MacOS M1:
Change the `mini` resources inside file system.go (before building the operator image):

```diff
	if options.MiniEnv {
		coreResourceList := corev1.ResourceList{
-			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(100), resource.Milli),
-			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(1), resource.Giga),
+			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(500), resource.Milli),
+			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(1), resource.Giga),
		}
		dbResourceList := corev1.ResourceList{
-			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(100), resource.Milli),
-			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(500), resource.Mega),
+			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(800), resource.Milli),
+			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(1), resource.Giga),
		}
		endpointResourceList := corev1.ResourceList{
-			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(100), resource.Milli),
-			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(500), resource.Mega),
+			corev1.ResourceCPU:    *resource.NewScaledQuantity(int64(500), resource.Milli),
+			corev1.ResourceMemory: *resource.NewScaledQuantity(int64(1), resource.Giga),
		}
```

### 2) Linux:
Change te MakeFile and insert a comment in the lines (before building the core image):
```diff
+ # DOCKER_BUILDKIT?=DOCKER_BUILDKIT=1
+ # ifeq ($(CONTAINER_ENGINE), podman)
+ # 	DOCKER_BUILDKIT=
+ # endif
```
