# Network Analyzer Documentation

## Overview
The `Network Analyzer` is a diagnostic tool designed to verify and ensure the connectivity and functionality of various services within your system. 

It performs the following checks:

- **Ping Tests**:
  - Ping to specific IPs.
  - Ping to DNS addresses.
- **DNS Resolution**:
  - Perform `nslookup` for specified domains.
- **HTTP Requests**:
  - Send `curl` requests to specified endpoints.
- **S3 Connectivity**:
  - Test HTTP and HTTPS connectivity to S3-compatible storage services.
- **AWS Services**:
  - Check HTTPS connectivity to:
    - **STS** (Security Token Service).
    - **IAM** (Identity and Access Management).
- **Metrics**:
  - Test HTTP connectivity for metrics endpoints.
- **RPC Requests**:
  - Send RPC requests to the management service.
- **Database Connectivity**:
  - Verify HTTP connectivity to database endpoints.
- **Deployment-Specific Checks**:
  - Validate connectivity in non-containerized deployments to the child forks of the endpoint primary process.

---


## Run on Containerized environment
1. There are 2 options:

    a. Run from noobaa-core pod - 
    ```bash
    oc rsh noobaa-core-0 
    node src/tools/diagnostics/analyze_network.js
    ```
    b. Run via noobaa operator CLI -
    ```bash
    noobaa diagnostics analyze network
    ```


## Run on Non Containerized environment
1. Run via noobaa-cli :
   ```bash
   noobaa-cli diagnose network --deployment_type=nc 2>/dev/null
   ```


## Example -
Run -
```bash
$ noobaa-cli diagnose network --deployment_type=nc 2>/dev/null
```
Output - 
```json
{
  "response": {
    "code": "NetworkStatus",
    "reply": {
      "forks_info": {},
      "analyze_network_res": [
        {
          "service": {
            "service": "S3_HTTP",
            "hostname": "hostname1",
            "port": 6001,
            "secure": false
          },
          "analyze_service_res": {
            "nslookup_status": {
              "status": "OK"
            },
            "ping_dns_status": {
              "status": "OK"
            },
            "ping_ip_status": {
              "status": "OK"
            },
            "curl_status": {
              "status": "OK"
            },
            "analyze_service_func_status": {
              "status": "OK"
            }
          }
        },
        {
          "service": {
            "service": "S3_HTTPS",
            "hostname": "hostname1",
            "port": 6443,
            "secure": true
          },
          "analyze_service_res": {
            "nslookup_status": {
              "status": "OK"
            },
            "ping_dns_status": {
              "status": "OK"
            },
            "ping_ip_status": {
              "status": "OK"
            },
            "curl_status": {
              "status": "OK"
            },
            "analyze_service_func_status": {
              "status": "OK"
            }
          }
        },
        {
          "service": {
            "service": "METRICS",
            "hostname": "hostname1",
            "port": 7004,
            "secure": false
          },
          "analyze_service_res": {
            "nslookup_status": {
              "status": "OK"
            },
            "ping_dns_status": {
              "status": "OK"
            },
            "ping_ip_status": {
              "status": "OK"
            },
            "curl_status": {
              "status": "OK"
            },
            "analyze_service_func_status": {
              "status": "OK"
            }
          }
        }
      ]
    }
  }
}
```