package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

var (
	accessKeyId     string
	secretKeyId     string
	awsRegion       string
	passingTests    []string
	failingTests    []string
	skippedTests    []string
	bucket          string
	key             string
	mpu             string
	endpointAddress string
	disableDeletion bool
)

type testName string

const (
	createBucketTest                testName = "createBucket"
	deleteBucketTest                testName = "deleteBucket"
	putObjectTest                   testName = "putObject"
	deleteObjectTest                testName = "deleteObject"
	createMultipartUploadTest       testName = "createMultipartUpload"
	uploadPartTest                  testName = "uploadPart"
	completeMultiPartUploadTest     testName = "completeMultiPartUpload"
	deleteMultipartUploadObjectTest testName = "deleteMultipartUploadObject"
)

func init() {
	flag.StringVar(&bucket, "bucket", "", "The `name` of the S3 bucket to create and add objects to.")
	flag.StringVar(&key, "key", "", "The `name` of the S3 object to put.")
	flag.StringVar(&mpu, "mpu", "", "The `name` of the S3 multi part upload.")
	flag.StringVar(&endpointAddress, "endpoint", "", "Set if you want non-AWS S3 endpoint.")
	flag.BoolVar(&disableDeletion, "disable-deletion", false, "Set to true if you want to disable deletion of the the objects and the bucket.")
}

// before running the script need to run:
// if it's AWS - use AWS credentials and details
// if it's NooBaa - use admin credentials and details from NooBaa system
// $ export AWS_ACCESS_KEY_ID=<access-key-id>
// $ export AWS_SECRET_ACCESS_KEY=<secret-key>
// $ export AWS_DEFAULT_REGION=<region>

// tested with the following command:
// on AWS:
// go run ./src/test/unit_tests/different_clients/go_aws_sdkv2_client.go -bucket <bucket-name> -key <key-name> -mpu <key-name-of-multi--part-upload> -endpoint "" [-disable-deletion]
// for example:
// go run ./src/test/unit_tests/different_clients/go_aws_sdkv2_client.go -bucket shira-test02 -key test-key -mpu test-mpu-key -endpoint "" -disable-deletion
// on NooBaa:
// go run ./src/test/unit_tests/different_clients/go_aws_sdkv2_client.go -bucket <bucket-name> -key <key-name> -mpu <key-name-of-multi--part-upload> -endpoint "<endpoint-address>" [-disable-deletion]
// for example:
// (MCG with admin credentials and kubectl port-forward -n test3 service/s3 12443:443)
// go run ./src/test/unit_tests/different_clients/go_aws_sdkv2_client.go -bucket second.bucket -key test-key -mpu test-mpu-key -endpoint "https://localhost:12443" -disable-deletion
func main() {
	printTestIntroduction()
	flag.Parse()
	checkRequiredFlags()
	client := configureS3Client()
	runTests(client)
	deleteObjectsAndBucket(client)
	printTestSummary()
}

// readEnv will read the environment variable and return its value
func readEnv(envVar string) string {
	value, exists := os.LookupEnv(envVar)
	if !exists {
		fmt.Printf("Env %s is not set\n", envVar)
	}
	return value
}

// checkRequiredFlag will check if the flag is empty and print the default flags
func checkRequiredFlag(flagName string) {
	if len(flagName) == 0 {
		flag.PrintDefaults()
		log.Fatalf("invalid parameters, %s name required", flagName)
	}
}

// checkRequiredFlags will check if each of the required flags is empty
func checkRequiredFlags() {
	checkRequiredFlag(bucket)
	checkRequiredFlag(key)
	checkRequiredFlag(mpu)
}

// printTestIntroduction will print the introduction of the test
func printTestIntroduction() {
	fmt.Println("Running a couple of tests using AWS SDK Go V2...")
	fmt.Println("--------------------------------------------------")
}

// printTestSummary will print the summary of the test (passing, failing and skipped tests)
func printTestSummary() {
	totalTests := len(passingTests) + len(failingTests)
	fmt.Println("--------------------------------------------------")
	fmt.Println("\nTotal Tests:", totalTests,
		"\nPassing Tests: ", len(passingTests), passingTests,
		"\nFailing Tests: ", len(failingTests), failingTests,
		"\nSkipped Tests: ", len(skippedTests), skippedTests,
	)
}

// runTests will run the tests
// according to the following list: Create Bucket, Put Object, Put Multipart Objects
// the deletion operation (Delete Object, Delete Multipart Upload Object and Delete Bucket) were moved to a separate function
func runTests(client *s3.Client) {
	createBucket(client, bucket)
	putObject(client, bucket, key)
	runTestMPU(client)
}

// runTestMPU will run the tests related to mutipart upload (createMultipartUpload, uploadPart and completeMultiPartUpload)
func runTestMPU(client *s3.Client) {
	uploadId := createMultipartUpload(client, bucket, mpu)
	if uploadId != nil {
		completedParts := uploadPart(client, bucket, mpu, uploadId)
		if completedParts != nil {
			completeMultiPartUpload(client, bucket, mpu, uploadId, completedParts)
		} else {
			skippedTests = append(skippedTests, "completeMultiPartUpload")
		}
	} else {
		skippedTests = append(skippedTests, "uploadPart")
		skippedTests = append(skippedTests, "completeMultiPartUpload")
	}
}

// deleteObjectsAndBucket will delete the 2 created objects (one from Put Objects and the other from Multipart Upload Objects) and the bucket
func deleteObjectsAndBucket(client *s3.Client) {
	if disableDeletion {
		fmt.Println("--------------------------------------------------")
		fmt.Println("disable-deletion flag was set, will not operate delete commands")
	} else {
		deleteObject(client, bucket, key, string(deleteObjectTest))
		deleteObject(client, bucket, mpu, string(deleteMultipartUploadObjectTest))
		deleteBucket(client, bucket)
	}
}

// configureS3Client will configure the S3 client according to the endpoint address
func configureS3Client() *s3.Client {
	var client *s3.Client
	accessKeyId = readEnv("AWS_ACCESS_KEY_ID")
	secretKeyId = readEnv("AWS_SECRET_ACCESS_KEY")
	awsRegion = readEnv("AWS_DEFAULT_REGION")

	if endpointAddress == "" {
		fmt.Println("Running on AWS endpoint")
		cfg, err := config.LoadDefaultConfig(
			context.TODO(),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyId, secretKeyId, "")),
			config.WithRegion(awsRegion))
		if err != nil {
			log.Fatalf("failed to load SDK configuration (AWS endpoint), %v", err)
		}
		client = s3.NewFromConfig(cfg)
	} else {
		fmt.Println("Running on configured endpoint", endpointAddress)
		cfg, err := config.LoadDefaultConfig(
			context.TODO(),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyId, secretKeyId, "")),
			config.WithHTTPClient(&http.Client{Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}),
		)
		if err != nil {
			log.Fatalf("failed to load SDK configuration (non AWS endpoint with address %s), %v", endpointAddress, err)
		}
		client = s3.NewFromConfig(cfg, func(o *s3.Options) {
			o.BaseEndpoint = &endpointAddress
			o.UsePathStyle = true
		})
	}
	return client
}

// createBucket will create a bucket with the given name
func createBucket(client *s3.Client, bucketName string) {
	fmt.Printf("\ncreating bucket %s\n", bucketName)

	params := &s3.CreateBucketInput{
		Bucket: &bucketName,
	}
	_, err := client.CreateBucket(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to create bucket %s. error: \n%v\n", bucketName, err)
		failingTests = append(failingTests, string(createBucketTest))
	} else {
		fmt.Printf("succeeded in create bucket %s.\n", bucketName)
		passingTests = append(passingTests, string(createBucketTest))
	}
}

// deleteBucket will delete the bucket with the given name
func deleteBucket(client *s3.Client, bucketName string) {
	fmt.Printf("\ndeleting bucket %s\n", bucketName)

	params := &s3.DeleteBucketInput{
		Bucket: &bucketName,
	}
	_, err := client.DeleteBucket(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to delete bucket %s. error: \n%v\n", bucketName, err)
		failingTests = append(failingTests, string(deleteBucketTest))
	} else {
		fmt.Printf("succeeded in delete bucket %s.\n", bucketName)
		passingTests = append(passingTests, string(deleteBucketTest))
	}
}

// putObject will put an object with the given key in the given bucket
func putObject(client *s3.Client, bucketName, keyName string) {
	fmt.Printf("\nput object %s in bucket %s\n", keyName, bucketName)
	content := "body for example"

	params := &s3.PutObjectInput{
		Bucket: &bucketName,
		Key:    &keyName,
		Body:   strings.NewReader(content), // pass string directly as io.Reader
	}
	_, err := client.PutObject(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to put object %s in bucket %s. error: \n%v\n", keyName, bucketName, err)
		failingTests = append(failingTests, string(putObjectTest))
	} else {
		fmt.Printf("succeeded in put object %s bucket %s.\n", keyName, bucketName)
		passingTests = append(passingTests, string(putObjectTest))
	}
}

// deleteObject will delete the object with the given key in the given bucket
func deleteObject(client *s3.Client, bucketName, keyName, testNameOperation string) {
	fmt.Printf("\ndelete object %s in bucket %s\n", keyName, bucketName)

	params := &s3.DeleteObjectInput{
		Bucket: &bucketName,
		Key:    &keyName,
	}
	_, err := client.DeleteObject(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to delete object %s in bucket %s. error: \n%v\n", keyName, bucketName, err)
		failingTests = append(failingTests, string(testNameOperation))
	} else {
		fmt.Printf("succeeded in delete object %s bucket %s.\n", keyName, bucketName)
		passingTests = append(passingTests, string(testNameOperation))
	}
}

// deleteObject will delete the object with the given key in the given bucket
func createMultipartUpload(client *s3.Client, bucketName, keyName string) *string {
	fmt.Printf("\ncreate multi part upload %s in bucket %s\n", keyName, bucketName)
	var output *s3.CreateMultipartUploadOutput

	params := &s3.CreateMultipartUploadInput{
		Bucket: &bucketName,
		Key:    &keyName,
	}
	output, err := client.CreateMultipartUpload(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to create multipart upload %s in bucket %s. error: \n%v\n", keyName, bucketName, err)
		failingTests = append(failingTests, string(createMultipartUploadTest))
		return nil
	} else {
		fmt.Printf("succeeded in create multipart upload %s bucket %s.\n", keyName, bucketName)
		passingTests = append(passingTests, string(createMultipartUploadTest))
		return output.UploadId
	}
}

// uploadPart will upload a part with the given key in the given bucket
func uploadPart(client *s3.Client, bucketName, keyName string, uploadId *string) []types.CompletedPart {
	fmt.Printf("\nupload part %s in bucket %s\n", keyName, bucketName)
	content := "body for example mpu"
	var partNumber int32 = 1
	var output *s3.UploadPartOutput

	params := &s3.UploadPartInput{
		Bucket:     &bucketName,
		Key:        &keyName,
		PartNumber: &partNumber,
		UploadId:   uploadId,
		Body:       strings.NewReader(content), // pass string directly as io.Reader
	}
	var completedParts []types.CompletedPart

	output, err := client.UploadPart(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to upload part %d %s in bucket %s. error: \n%v\n", partNumber, keyName, bucketName, err)
		failingTests = append(failingTests, string(uploadPartTest))
		return nil
	} else {
		fmt.Printf("succeeded in upload part %d %s in bucket %s.\n", partNumber, keyName, bucketName)
		passingTests = append(passingTests, string(uploadPartTest))
		completedParts = append(completedParts, types.CompletedPart{
			ETag:       output.ETag,
			PartNumber: &partNumber,
		})
		return completedParts
	}
}

// completeMultiPartUpload will complete the multi part upload with the given key in the given bucket
func completeMultiPartUpload(client *s3.Client, bucketName, keyName string, uploadId *string, completedParts []types.CompletedPart) {
	fmt.Printf("\ncomplete multi part %s in bucket %s\n", keyName, bucketName)

	params := &s3.CompleteMultipartUploadInput{
		Bucket:   &bucketName,
		Key:      &keyName,
		UploadId: uploadId,
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completedParts,
		},
	}
	_, err := client.CompleteMultipartUpload(context.TODO(), params)
	if err != nil {
		fmt.Printf("got error when trying to complete multi part upload %s in bucket %s. error: \n%v\n", keyName, bucketName, err)
		failingTests = append(failingTests, string(completeMultiPartUploadTest))
	} else {
		fmt.Printf("succeeded in upload part %s in bucket %s.\n", keyName, bucketName)
		passingTests = append(passingTests, string(completeMultiPartUploadTest))
	}
}

// useful links:
// I started from this example: https://github.com/aws/aws-sdk-go-v2/blob/main/example/service/s3/listObjects/listObjects.go
// configurations: https://docs.aws.amazon.com/sdk-for-go/v2/developer-guide/configure-gosdk.html
// endpoint configuration (took the simple approach): https://docs.aws.amazon.com/sdk-for-go/v2/developer-guide/configure-endpoints.html
// disable tls certificate verification: https://github.com/aws/aws-sdk-go-v2/issues/1295#issuecomment-860487390
// AWS code examples with AWS SDK Go V2: https://docs.aws.amazon.com/code-library/latest/ug/go_2_s3_code_examples.html
// complete MPU: https://medium.com/@hirok4/implementation-of-multipart-upload-in-go-19eeb456d723
