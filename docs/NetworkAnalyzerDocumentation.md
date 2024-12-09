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

* NooBaa on `host1` is not running.
* NooBaa on `host2` is running.

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
      "forks_info": {
        "host1": {
          "total_fork_count": 3,
          "responsive_forks": [],
          "error": {
            "code": "ECONNRESET"
          }
        },
        "host2": {
          "total_fork_count": 3,
          "responsive_fork_ids": [
            3,
            1,
            2
          ]
        }
      },
      "analyze_network_response": [
        {
          "service": "S3_HTTP",
          "hostname": "host1",
          "port": 8081,
          "secure": false,
          "nslookup_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "ping_dns_status": {
            "status": "❌ FAILURE",
            "error": [
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m"
            ]
          },
          "ping_ip_status": {
            "status": "❌ FAILURE",
            "error": "host is missing undefined"
          },
          "curl_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "service_call_status": {
            "status": "⏭️ SKIPPED_TEST"
          }
        },
        {
          "service": "S3_HTTPS",
          "hostname": "host1",
          "port": 6443,
          "secure": true,
          "nslookup_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "ping_dns_status": {
            "status": "❌ FAILURE",
            "error": [
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m"
            ]
          },
          "ping_ip_status": {
            "status": "❌ FAILURE",
            "error": "host is missing undefined"
          },
          "curl_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "service_call_status": {
            "status": "⏭️ SKIPPED_TEST"
          }
        },
        {
          "service": "METRICS",
          "hostname": "host1",
          "port": 7004,
          "secure": false,
          "nslookup_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "ping_dns_status": {
            "status": "❌ FAILURE",
            "error": [
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m",
              "ping_service: ping node failed', host, \u001b[32m'ping: host1: Name or service not known\\n'\u001b[39m"
            ]
          },
          "ping_ip_status": {
            "status": "❌ FAILURE",
            "error": "host is missing undefined"
          },
          "curl_status": {
            "status": "❌ FAILURE",
            "error": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          },
          "service_call_status": {
            "status": "❌ FAILURE",
            "error_output": {
              "errno": -3008,
              "code": "ENOTFOUND",
              "syscall": "getaddrinfo",
              "hostname": "host1"
            }
          }
        },
        {
          "service": "S3_HTTP",
          "hostname": "host2",
          "port": 8081,
          "secure": false,
          "ip": "127.0.0.1",
          "nslookup_status": {
            "status": "✅ SUCCESS"
          },
          "ping_dns_status": {
            "status": "✅ SUCCESS"
          },
          "ping_ip_status": {
            "status": "✅ SUCCESS"
          },
          "curl_status": {
            "status": "✅ SUCCESS"
          },
          "service_call_status": {
            "status": "⏭️ SKIPPED_TEST"
          }
        },
        {
          "service": "S3_HTTPS",
          "hostname": "host2",
          "port": 6443,
          "secure": true,
          "ip": "127.0.0.1",
          "nslookup_status": {
            "status": "✅ SUCCESS"
          },
          "ping_dns_status": {
            "status": "✅ SUCCESS"
          },
          "ping_ip_status": {
            "status": "✅ SUCCESS"
          },
          "curl_status": {
            "status": "✅ SUCCESS"
          },
          "service_call_status": {
            "status": "⏭️ SKIPPED_TEST"
          }
        },
        {
          "service": "METRICS",
          "hostname": "host2",
          "port": 7004,
          "secure": false,
          "ip": "127.0.0.1",
          "nslookup_status": {
            "status": "✅ SUCCESS"
          },
          "ping_dns_status": {
            "status": "✅ SUCCESS"
          },
          "ping_ip_status": {
            "status": "✅ SUCCESS"
          },
          "curl_status": {
            "status": "✅ SUCCESS"
          },
          "service_call_status": {
            "status": "✅ SUCCESS",
            "metrics_output": {
              "nsfs_counters": {},
              "op_stats_counters": {},
              "fs_worker_stats_counters": {}
            }
          }
        }
      ]
    }
  }
}
```