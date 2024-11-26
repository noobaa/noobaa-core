# Bucket Notifications

## Bucket Notification Configuration

Bucket's notifications can be configured with the s3api operation [put-bucket-notification-configuration](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/put-bucket-notification-configuration.html).
Specify notifications under the "TopicConfigurations" field, which is an array of jsons, one for each notification.
A notification json has these fields:
- Id: Mandatory. A unique string identifying the notification configuration.
- Events: Optional. An array of [events](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html) for which the notification is relevant.
          If not specified, the notification is relevant for all events.
- TopicArn: The path to the connection file

Example for a bucket's notification configuration, in a file:
{
    "TopicConfigurations": [
        {
	    "Id": "created_from_s3op",
            "TopicArn": "/opt/noobaa/connect.kv",
            "Events": [
                "s3:ObjectCreated:*"
            ]
        }
    ]
}


## Connection file
A connection file contains some fields that specify the target notification server.
The path to a connection file is specified in TopicArn field of the [notification configuration](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/put-bucket-notification-configuration.html)
In a containerized environment, the operator will mount the secrets as file in the core pod (see operator doc for more info).
In a non-containerized system, you must create the relevant file manually.

### Common connection fields
- name: A string identifying the connection (mandatory).
- notification_protocol: One of: http, https, kafka (mandatory).

### Http(s) connection fields
- agent_request_object: Value is a JSON that is passed to to nodejs' http(s) agent (mandatory).
Any field supported by nodejs' http(s) agent can be used, specifically 'host' and 'port'.
A full list of options is [here](https://nodejs.org/docs/latest-v22.x/api/http.html#new-agentoptions).
- request_options_object: Value is a JSON that is passed to nodejs' http(s) request (optional).
Any field supported by nodejs' http(s) request option can be used, specifically 'auth' can be
used for http simple auth. Value for 'auth' is of the syntax: <name>:<passowrd>.
A full list of options is [here](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback).

### Kafka connection fields
- metadata.broker.list: A CSV list of Kafka brokers (mandatory).
- topic: A topic for the Kafka message (mandatory).
