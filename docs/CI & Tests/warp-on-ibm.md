# Warp IBM Cloud Automation Infrastructure

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Architecture Overview](#architecture-overview)
4. [Execution Flow](#execution-flow)
5. [GitHub Workflows](#github-workflows)
6. [Cloud-Init Configuration](#cloud-init-configuration)
7. [Helper Scripts](#helper-scripts)
8. [Log Locations](#log-locations)
9. [Debugging](#debugging)

## Introduction

The Warp IBM Cloud automation infrastructure provides automated nightly performance testing for NooBaa using Warp benchmarks on dedicated IBM Cloud VMs. This system automatically provisions virtual machines, runs Warp tests, uploads results to IBM Cloud Object Storage, sends notifications to Slack, and cleans up resources.

## Prerequisites

Before using the IBM Cloud automation infrastructure, the following GitHub secrets must be configured in the repository settings:

### Required Secrets

| Secret Name | Description |
|-------------|-------------|
| `IBM_CLOUD_API_KEY` | IBM Cloud API key with VPC infrastructure permissions |
| `SLACK_NIGHTLY_RESULTS_URL` | Slack webhook URL for nightly test result notifications |
| `IBM_COS_WRITER_CREDENTIALS` | JSON configuration for IBM Cloud Object Storage access (see below)
| `IBM_WARP_VM_CONFIG` | JSON configuration for VM provisioning (see below) |

### IBM_COS_WRITER_CREDENTIALS

The `IBM_COS_WRITER_CREDENTIALS` secret must be a **single line** JSON string containing the following keys:

```json
{
   "AWS_ACCESS_KEY_ID": "...",
   "AWS_SECRET_ACCESS_KEY": "..."
}
```

### IBM_WARP_VM_CONFIG Structure

The `IBM_WARP_VM_CONFIG` secret must be a **single line** JSON string containing the following keys:

```json
{
  "INSTANCE_NAME": "...", // Base name for the VSI
  "RESOURCE_TAG": "...", // Tag to identify related resources
  "VPC_NAME": "...", // Name of VPC to use
  "REGION": "...", // Desired VSI region
  "ZONE": "...", // Desired VSI zone
  "INSTANCE_PROFILE": "...", // Desired VSI profile
  "FLOATING_IP_NAME": "...", // Base name for the floating IP
  "SUBNET_ID": "...", // ID of subnet to use
  "IMAGE_ID": "...", // ID of OS image to use
  "SECURITY_GROUP_ID": "...", // ID of security group to use
  "WARP_LOGS_BUCKET": "...", // Name of IBM COS bucket to store the Warp logs in
  "IBM_COS_ENDPOINT": "..." // IBM COS endpoint to use in order to access the logs bucket
}
```

## Architecture Overview

The automation uses a dispatcher pattern with four main components working together:

1. **Provisioning Dispatcher** - Triggers the provisioning workflow at midnight UTC
2. **Provisioning Workflow** - Creates IBM Cloud VMs with proper networking and security
3. **VM Configuration** - Sets up the testing environment using cloud-init
4. **Cleanup Dispatcher & Workflow** - Automatically removes VMs and associated resources at 4 AM UTC

```
┌─────────────────┐    ┌─────────────────┐     ┌─────────────────┐
│   Provision     |    |                 |     |     Cleanup     |
|   Dispatcher    │    │   Test & Log    │     │   Dispatcher    │
│   (Midnight)    │───▶│   (3+ hours)    │───▶│     (4 AM)      │
└─────────────────┘    └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   Provision VM             Warp tests              Cleanup VM
   Floating IP              Log upload              Release IP
   Cloud-init               Slack notification      Tag-based search
```

## Execution Flow

This section provides a detailed walkthrough of the complete automation flow, from the midnight UTC trigger through all involved files and their roles, until the 4 AM cleanup.

### Timeline Overview

| Time (UTC) | Phase | Duration | Description |
|------------|-------|----------|-------------|
| 00:00 | **Provisioning** | ~1 minute | GitHub Actions provisions IBM Cloud VM |
| 00:01 | **VM Setup** | ~3 minutes | Cloud-init configures and sets up the VM environment |
| 00:05 | **Image Building** | ~20 minutes | The NooBaa tester image is built locally |
| 00:25 | **Testing** | ~3 hours | Warp performance tests execute |
| 03:30 | **Results** | ~2 minutes | Log upload and Slack notification |
| 04:00 | **Cleanup** | ~1 minute | GitHub Actions cleans up all resources (in case any are left) |

### Detailed Flow

#### 1. Midnight UTC Trigger

**Triggered by**: GitHub Actions cron schedule  
**File**: `.github/workflows/ibm-nightly-provision-dispatcher.yaml`

The provisioning dispatcher workflow is triggered by the cron expression `'0 0 * * *'` and calls the reusable provisioning workflow (`.github/workflows/ibm-nightly-vm-provision.yaml`) which begins the following sequence:

1. **Environment Setup**
   - Installs IBM Cloud CLI and VPC plugin
   - Extracts and masks sensitive configuration from `IBM_WARP_VM_CONFIG` secret (passed as `VM_CONFIG` to the reusable workflow)
   - Authenticates with IBM Cloud using `IBM_CLOUD_API_KEY`

2. **Cloud-Init Preparation**
   - Uses `envsubst` to inject GitHub secrets into the cloud-init template
   - Creates `/tmp/ibm-vm-runner-config-with-secrets.yaml` with populated environment variables

3. **VM Provisioning**
   - Creates IBM Cloud VM instance with specified configuration
   - Attaches the VM to the configured VPC, subnet, and security group
   - Passes the prepared cloud-init configuration as user data

4. **Network Configuration**
   - Reserves a floating IP in the same zone as the VM
   - Binds the floating IP to the VM's primary network interface
   - Enables external connectivity for log uploads and notifications

#### 2. VM Initialization

**Triggered by**: VM boot process  
**File**: `.github/ibm-warp-runner-config.yaml`

Once the VM starts, cloud-init takes over using the configuration file:

1. **System Setup**
   - Updates package repositories
   - Installs required packages

2. **Environment Configuration**
   - Creates `/etc/warp.env` with environment variables from GitHub secrets
   - Sets up Node.js path for Slack webhook functionality

3. **Security & Services**
   - Schedules automatic VM shutdown after 4 hours (`shutdown -P '+240'`) as a safety measure
   - Adds `ubuntu` user to `docker` group for container access
   - Enables and starts Docker daemon

4. **Repository Setup**
   - Clones the NooBaa core repository to `/home/ubuntu/tests/noobaa-core`
   - Installs helper scripts to system path:
     - `run_containerized_warp_on_cloud_runner.sh` → `/usr/local/bin/`
     - `slack_notifier.js` → `/usr/local/bin/`

5. **Test Execution Launch**
   - Executes `/usr/local/bin/run_containerized_warp_on_cloud_runner.sh` as the final step

#### 3. Warp Testing Phase

**File**: `tools/ibm_runner_helpers/run_containerized_warp_on_cloud_runner.sh`

The main orchestration script handles the entire testing workflow:

1. **Environment Loading**
   - Sources environment variables from `/etc/warp.env`

2. **Container Preparation**
   - Builds the NooBaa tester Docker image locally on the VM
   - Prepares the containerized testing environment

3. **Warp Test Execution**
   - Runs Warp performance tests with parameters:
     - `--duration 3h` - 3-hour test duration
     - `--obj-size 10m` - 10MB object size
     - `--obj-randsize` - Random object sizes (up to 10MB)
   - Captures all test output and metrics

#### 4. Results & Notification

**Files**: 
- `tools/ibm_runner_helpers/run_containerized_warp_on_cloud_runner.sh`
- `tools/ibm_runner_helpers/slack_notifier.js`

1. **Log Upload**
   - Uses AWS CLI to upload test results to IBM Cloud Object Storage

2. **Slack Notification**
   - Calls `slack_notifier.js` with test results
   - Sends notification to configured Slack channel via webhook

3. **VM Shutdown**
   - Initiates VM shutdown regardless of test outcome
   - Ensures clean termination of the test environment

#### 5. Resource Cleanup

**Triggered by**: GitHub Actions cron schedule  
**File**: `.github/workflows/ibm-nightly-cleanup-dispatcher.yaml`

The cleanup dispatcher workflow runs at 4 AM UTC (`'0 4 * * *'`), providing a 4-hour window for testing. It calls the reusable cleanup workflow (`.github/workflows/ibm-nightly-vm-cleanup.yaml`) which performs:

1. **Environment Setup**
   - Installs IBM Cloud CLI and VPC plugin
   - Extracts VM configuration from `IBM_WARP_VM_CONFIG` secret (passed as `VM_CONFIG` to the reusable workflow)
   - Authenticates with IBM Cloud

2. **Floating IP Cleanup**
   - Searches for the floating IP by resource tag (`IBM_WARP_VM_CONFIG.RESOURCE_TAG`)
   - Releases the floating IP if found

3. **VM Cleanup**
   - Searches for the VM instance by resource tag (`IBM_WARP_VM_CONFIG.RESOURCE_TAG`)
   - Forcibly deletes the VM instance if found
   - Waits and verifies complete deletion

4. **Verification**
   - Confirms successful resource cleanup
   - Logs cleanup status for monitoring
   - Ensures no orphaned resources remain

## GitHub Workflows

The automation uses a dispatcher pattern with four main workflow files:

### Nightly VM Provisioning Dispatcher

**File**: [`.github/workflows/ibm-nightly-provision-dispatcher.yaml`](../../.github/workflows/ibm-nightly-provision-dispatcher.yaml)

**Schedule**: Daily at midnight UTC (00:00)  
**Purpose**: Triggers the reusable provisioning workflow with the required configuration

### Nightly VM Provisioning (Reusable)

**File**: [`.github/workflows/ibm-nightly-vm-provision.yaml`](../../.github/workflows/ibm-nightly-vm-provision.yaml)

**Trigger**: Called by the provisioning dispatcher  
**Purpose**: Handles the actual VM provisioning, networking setup, and cloud-init configuration

### Nightly VM Cleanup Dispatcher

**File**: [`.github/workflows/ibm-nightly-cleanup-dispatcher.yaml`](../../.github/workflows/ibm-nightly-cleanup-dispatcher.yaml)

**Schedule**: Daily at 4 AM UTC (04:00) - 4 hours after provisioning
**Purpose**: Triggers the reusable cleanup workflow

### Nightly VM Cleanup (Reusable)

**File**: [`.github/workflows/ibm-nightly-vm-cleanup.yaml`](../../.github/workflows/ibm-nightly-vm-cleanup.yaml)

**Trigger**: Called by the cleanup dispatcher  
**Purpose**: Handles the actual resource cleanup (VMs and floating IPs)

## Cloud-Init Configuration

**File**: [`.github/ibm-warp-runner-config.yaml`](../../.github/ibm-warp-runner-config.yaml)

This cloud-init configuration automatically sets up the VM environment for Warp testing.
The config includes:
 - The required packages that'll be installed on the VM
 - Additional setup commands
 - An environment file (`warp.env`) that is used to pass env vars from GitHub to the runner (via `envsubst` variable templating)
 - The 'entrypoint' (that is the last command that is run by cloud-init; in our case, the Warp scripts)

## Helper Scripts

### Containerized Warp Runner

**File**: [`tools/ibm_runner_helpers/run_containerized_warp_on_cloud_runner.sh`](../../tools/ibm_runner_helpers/run_containerized_warp_on_cloud_runner.sh)

The main orchestration script that:
- Builds the NooBaa tester image locally on the VM
- Runs the Warp tests (currently with the parameters `--duration 3h --obj-size 10m --obj-randsize`)
- Handles success/failure scenarios with appropriate notifications
- Uploads logs to IBM COS with timestamped directory structure
- Ensures VM shutdown regardless of test outcome

### Slack Notifier

**File**: [`tools/ibm_runner_helpers/slack_notifier.js`](../../tools/ibm_runner_helpers/slack_notifier.js)

Simple Node.js helper script for sending notifications - mostly used in favor of clumsy cURL commands

## Log locations:
- **GitHub Actions**: Workflow run logs in GitHub UI
- **VM logs**: `/var/log/cloud-init.log` and `/var/log/cloud-init-output.log`
- **Test results**: Uploaded to IBM COS bucket with timestamp-based paths

## Debugging

### Serial Console Access

As a hardening measure, the test runner VMs cannot usually be accessed - no SSH key or username and password are authorized by default. However, `cloud-init` prints all of its output to the VM's serial console, which can be accessed from the IBM Cloud web UI without machine authentication.

**To access the serial console:**
1. Navigate to the IBM Cloud web console
2. Go to **VPC Infrastructure** → **Virtual server instances**
3. Find your warp test VM instance
4. Click the **kebab menu** (three dots) next to the instance
5. Select **"Open serial console"**

This provides real-time access to the VM's console output, including all cloud-init logs and script execution details.

### Debug VM with SSH Access

If further debugging is required beyond console logs, you can provision a debug VM with SSH access:

1. **Export required environment variables** locally from the "Required Secrets" section:
   ```bash
   export IBM_CLOUD_API_KEY="your-api-key"
   export IBM_WARP_VM_CONFIG='{"INSTANCE_NAME": "example-name", ...}'
   # ... other required variables
   ```

2. **Modify the cloud-init configuration** (`ibm-warp-runner-config.yaml`) to add SSH access:
   ```yaml
   # Add SSH key or user authentication
   ssh_authorized_keys:
     - ssh-rsa AAAA... your-public-key
   ```

3. **Run the provisioning commands manually** from the workflow to create a debuggable VM:
   ```bash
   # Install IBM Cloud CLI
   curl -fsSL https://clis.cloud.ibm.com/install/linux | sh
   ibmcloud plugin install vpc-infrastructure -f
   
   # Authenticate and provision
   ibmcloud login --apikey "$IBM_CLOUD_API_KEY" -r "$REGION"
   ibmcloud is instance-create ... --user-data @modified-config.yaml
   ```

4. **SSH into the debug VM**

**Important**: Remember to clean up debug VMs manually after troubleshooting
