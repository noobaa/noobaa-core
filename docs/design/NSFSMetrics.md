# NSFS metrics 


## GOALS
 * Collect and Expose NSFS related metrics:
    * Provides S3 Operations Metrics
    * I/O Count Metrics 
    * FS Operations Metrics
 * Provide the Admin the ability to get the metrics from an exposed route. 

## SOLUTION

 * For S3 and FS Operations Metric we will collect min time, max time, average time, count, and error count
 * For I/O Count Metrics we will collect read/write count and bytes.
 * We will collect the metrics per endpoint, send them to the core, and aggregate all the endpoint values.
 * The metrics will not be persistent. on pod restart, we will lose the metrics collected to this point.
 * We will expose the metrics via the `/metrics/nsfs_stats` route.
 * The collection will be done between 2 scraping windows, hence each call for the route will reset the metrics.
 * We will expose only metrics that happen on the above window. 

<div id="top" />
<img src="/docs/design/images/NSFS_metrics.png" />

 ## The Metrics Flow

 * The client address the Endpoint with an S3 operation
 * Reaching the `object_sdk`, the operation will get timed. time, name and if it is an error will be sent to the endpoint stat collector per op.
 * The s3 operation timing will be collected for all types of namespaces, as it is being collected inside the object_sdk.
 * On read and write op, we will count the I/O (as we do today), and instead of sending it to the DB, we will collect it in memory.
 * If the namespace type is NSFS we will reach the `fs_napi` via `namespace_fs` and there on the `FSworker` we will time the `Work` function.
 * Reaching the `fs_napi`, the operation will get timed. time, name and if it is an error will be sent to the endpoint stat collector per Worker.
 * In order to time the `Work` function, we add to the NAPI context a function (`report_fs_stats`) from the endpoint stat collector, that populates a global object in the endpoint stat collector.
 * In the FSworker `OnOk` and `OnError` functions we will collect the time, name, and if it is an error and call the `report_fs_stats` which will update a global object in the endpoint stat collector.
 * In the endpoint functions, we will collect min time, max time, a sum of all the times, count, and error count. 
 * The sum of the times is being collected as we want to send that to the core and there we will want to do an average of all the times from all the endpoints.
 * Per each call, we will send the metrics to the core, using the stat aggregator, and will reset the endpoint stat collector objects.
 * On the core we will calculate the min time, max time, average of the times, count, and error count and keep them in memory.
 * When the admin address the `/metrics/nsfs_stats` route, we will expose the metrics and reset the stat aggregator fs metrics.


### Updating the nsfs stat in the stat aggregator (Core) - API
 * The nsfs stats will be an object with 3 fields one per each metric type:
    * op_stats - S3 Operations Metrics
    * io_stats - I/O Count Metrics
    * fs_workers_stats - FS Operations Metric

 Schema of the method:
 ```
   update_nsfs_stats: {
      method: 'PUT',
      params: {
            type: 'object',
            properties: {
               nsfs_stats: {
                  type: 'object',
                  properties: {
                        namespace_resource_id: {
                           objectid: true
                        },
                        io_stats: {
                           $ref: 'common_api#/definitions/io_stats'
                        },
                        op_stats: {
                           $ref: 'common_api#/definitions/op_stats'
                        },
                        fs_workers_stats: {
                           $ref: 'common_api#/definitions/fs_workers_stats'
                        }

                  }
               },
            }
      },
      auth: {
            system: ['admin']
      }
   }
```




 
  


