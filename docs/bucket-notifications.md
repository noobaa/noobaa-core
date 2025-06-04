# Bucket Notifications

## Bucket Notification Configuration

Bucket's notifications can be configured with the s3api operation [put-bucket-notification-configuration](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/put-bucket-notification-configuration.html).
Specify notifications under the "TopicConfigurations" field, which is an array of jsons, one for each notification.
A notification json has these fields:fffffffff
- Id: Mandatory. A unique string identifying the notification configuration.
- Events: Optional. An array of [events](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html) for which the notification is relevant.
          If not specified, the notification is relevant for all events.
- TopicArn: The connection file (see below). (To specify a Kafka target topic, see "Kafka Connection Fields" below).

Note that in alignment with AWS notification configuration, a test notification is sent to the external server during put-bucket-notification-configuration execution.
A successful test notification is a prequisite for the put-bucket-notification-configuration op.

Example for a bucket's notification configuration on containerized environment, in a file:
{
    "TopicConfigurations": [
        {
            "Id": "created_from_s3op",
            "TopicArn": "secret-name/connect.json",
            "Events": [
                "s3:ObjectCreated:*"
            ]
        }
    ]
}

Example for a bucket's notification configuration on a non-containerized environment, in a file:
{
    "TopicConfigurations": [
        {
            "Id": "created_from_s3op",
            "TopicArn": "connect",
            "Events": [
                "s3:ObjectCreated:*"
            ]
        }
    ]
}

## Connection File
A connection file contains some fields that specify the target notification server.
The connection file name is specified in TopicArn field of the [notification configuration](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/put-bucket-notification-configuration.html)

-In a containerized environment, the operator will mount the secrets as file in the core pod (see operator doc for more info).
The mount path is `/etc/notif_connect/<secret-name>/<secret failename>`, and the notification reference the file by the `<secret-name>/<secret filename>` path in TopicArn field.
For example, if seceret was created with:
`kubectl create secret generic notif-secret --from_file connect.json`
Then TopicArn should be `notif-secret/connect.json`.

-In a non-containerized system, you must create the relevant file using the 'connections' CRUD cli.
See the NC cli doc for more info.
Connect file contains a single json with the fields specified below.

### Common Connection Fields
- name: A string identifying the connection (mandatory).
- notification_protocol: One of: http, https, kafka (mandatory).

### Http(s) Connection Fields
- agent_request_object: Value is a JSON that is passed to to nodejs' http(s) agent (mandatory).
Any field supported by nodejs' http(s) agent can be used, specifically 'host' and 'port'.
A full list of options is [here](https://nodejs.org/docs/latest-v22.x/api/http.html#new-agentoptions).
Notable fields include:
    - host: hostname (or ip) of external server to receive the notifications
    - port: http(s) port on which the external server listens
    - timeout: connection timeout in milliseconds.
    - local_file_ca - path to CA pem file that signed server's TLS cert (if CA needs to be customized)
    - rejectUnauthorized - set to true to accept self-signed certs (useful for testing, do not use in production).
    - local_file_cert: path to client's private TLS certificate PEM file.
    - local_file_key: path to client's private TLS key PEM file.

- request_options_object: Value is a JSON that is passed to nodejs' http(s) request (optional).
Any field supported by nodejs' http(s) request option can be used, specifically:
-- path: used to specify the url path
-- auth: used for http simple auth. Value for 'auth' is of the syntax: <name>:<passowrd>.

A full list of options is [here](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback).

### Kafka Connection Fields
- metadata.broker.list: A CSV list of Kafka brokers (mandatory).
- topic: A topic for the Kafka message (mandatory).

## Event Types
S3 spec lists several events and "sub events".

The list of supported events are:

- s3:ObjectCreated:*
- s3:ObjectCreated:Put
- s3:ObjectCreated:Post
- s3:ObjectCreated:Copy
- s3:ObjectCreated:CompleteMultipartUpload
- s3:ObjectRemoved:*
- s3:ObjectRemoved:Delete
- s3:ObjectRemoved:DeleteMarkerCreated
- s3:ObjectRestore:*
- s3:ObjectRestore:Post
- s3:ObjectRestore:Completed
- s3:ObjectRestore:Delete
- s3:ObjectTagging:*
- s3:ObjectTagging:Put
- s3:ObjectTagging:Delete
- s3:LifecycleExpiration:*
- s3:LifecycleExpiration:Delete
- s3:LifecycleExpiration:DeleteMarkerCreated

## Event Processing and Failure Handling
Once NooBaa finds an event with a relevant notification configuration, the notification
is written to a persistent file.
Location of persistent files is determined by-
- For containerized, the pvc specified in NooBaa Bucket Notification spec (see Operator docs for more info).
- For NC, the env variable NOTIFIaaaaCATION_LOG_DIR (see NC docs for more info).

Files are processed by-
- For containerized, files are contantly being processed in the background of the core pod.
- For NC, files are processed by running manage_nsfs with 'notification' action.

If a notification fails to be sent to the external server, it will be re-written to a persistent file (assuming the
notification is still configured).
Once this new file is processed, NooBaa will try to re-send the failed notification.
