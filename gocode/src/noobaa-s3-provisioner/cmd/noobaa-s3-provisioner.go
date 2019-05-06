/*
Copyright 2018 The Kubernetes Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"flag"
	"fmt"
	_ "net/url"
	"os"
	"os/signal"
	"syscall"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/session"
	awsuser "github.com/aws/aws-sdk-go/service/iam"
	"github.com/aws/aws-sdk-go/service/s3"

	"github.com/golang/glog"
	"github.com/yard-turkey/lib-bucket-provisioner/pkg/apis/objectbucket.io/v1alpha1"
	libbkt "github.com/yard-turkey/lib-bucket-provisioner/pkg/provisioner"
	apibkt "github.com/yard-turkey/lib-bucket-provisioner/pkg/provisioner/api"
	bkterr "github.com/yard-turkey/lib-bucket-provisioner/pkg/provisioner/api/errors"

	storageV1 "k8s.io/api/storage/v1"
	"k8s.io/client-go/kubernetes"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

const (
	defaultRegion    = "us-west-1"
	httpPort         = 80
	httpsPort        = 443
	provisionerName  = "noobaa.io/bucket"
	createBucketUser = false
	obStateUser      = "UserName"
	maxBucketLen     = 58
	maxUserLen       = 63
	genUserLen       = 5
)

var (
	kubeconfig string
	masterURL  string
)

type noobaaS3Provisioner struct {
	bucketName string
	region     string
	// session is the aws session
	session *session.Session
	// s3svc is the aws s3 service based on the session
	s3svc *s3.S3
	// iam client service
	iamsvc *awsuser.IAM
	//kube client
	clientset *kubernetes.Clientset
	// access keys for aws acct for the bucket *owner*
	bktOwnerAccessID    string
	bktOwnerSecretKey   string
	bktCreateUser       string
	bucketUserName      string
	bucketUserAccessID  string
	bucketUserSecretKey string
	bktUserAccountID    string
	bktUserPolicyArn    string

	// noobaa fields
	nbClient   *NoobaaClient
	nbConnInfo *NoobaaConnectionInfo
}

func newNoobaaS3Provisioner(cfg *restclient.Config, s3Provisioner noobaaS3Provisioner) (*libbkt.Controller, error) {
	const allNamespaces = ""
	return libbkt.NewProvisioner(cfg, provisionerName, s3Provisioner, allNamespaces)
}

// Return the aws default session.
func awsDefaultSession() (*session.Session, error) {

	glog.V(2).Infof("Creating AWS *default* session")
	return session.NewSession(&aws.Config{
		Region: aws.String(defaultRegion),
		//Credentials: credentials.NewStaticCredentials(os.Getenv),
	})
}

// Return the OB struct with minimal fields filled in.
func (p *noobaaS3Provisioner) rtnObjectBkt(bktName string) *v1alpha1.ObjectBucket {

	conn := &v1alpha1.Connection{
		Endpoint: &v1alpha1.Endpoint{
			BucketHost: "http://" + p.nbConnInfo.Endpoint,
			BucketPort: httpPort,
			BucketName: bktName,
			SSL:        false,
		},
		Authentication: &v1alpha1.Authentication{
			AccessKeys: &v1alpha1.AccessKeys{
				AccessKeyID:     p.bucketUserAccessID,
				SecretAccessKey: p.bucketUserSecretKey,
			},
		},
		AdditionalState: map[string]string{
			obStateUser: p.bucketUserName,
		},
	}

	return &v1alpha1.ObjectBucket{
		Spec: v1alpha1.ObjectBucketSpec{
			Connection: conn,
		},
	}
}

func (p *noobaaS3Provisioner) createBucket(bucketName string) error {

	err := p.nbClient.CreateBucket(bucketName)
	if err != nil {
		if nbErr, ok := err.(*NoobaaRPCError); ok {
			if nbErr.RPCCode == "BUCKET_ALREADY_EXISTS" {
				msg := fmt.Sprintf("Bucket %q already exists", bucketName)
				return bkterr.NewBucketExistsError(msg)
			}
		}
		return fmt.Errorf("Bucket %q could not be created: %v", bucketName, err)
	}
	glog.Infof("Bucket %s successfully created", bucketName)

	//Now at this point, we have a bucket and an owner
	//we should now create the user for the bucket
	return nil
}

func (p *noobaaS3Provisioner) noobaaClientFromStorageClass(sc *storageV1.StorageClass) error {

	secretNS, secretName := getSecretName(sc)
	if secretName == "" {
		glog.Errorf("secret name or namespace are empty in storage class %q", sc.Name)
		return fmt.Errorf("Noobaa credentials secret and namespace are required in storage class %q", sc.Name)
	}

	if secretNS == "" {
		secretNS = "default"
	}

	// get the sc's noobaa crednetials secret
	err := p.connInfoFromSecret(p.clientset, secretNS, secretName)
	if err != nil {
		return err
	}

	// use the OBC's SC to create our session, set receiver fields
	glog.V(2).Infof("DZDZ - Creating noobaa rpc client using credentials from storage class %s's secret. email=%s system=%s endpoint=%s",
		sc.Name, p.nbConnInfo.Email, p.nbConnInfo.SystemName, p.nbConnInfo.Endpoint)

	p.nbClient, err = NewNoobaaClient(*p.nbConnInfo)
	if err != nil {
		glog.Errorf("failed creating noobaa client. %s", err)
		return err
	}

	return err

}

// Create a noobaa rpc client.
func (p *noobaaS3Provisioner) setNoobaaClient(sc *storageV1.StorageClass) error {
	// set the aws session
	glog.V(2).Infof("Creating a noobaa client based on storageclass %q", sc.Name)
	err := p.noobaaClientFromStorageClass(sc)
	if err != nil {
		return fmt.Errorf("error creating noobaa client: %v", err)
	}

	return nil
}

// initializeCreateOrGrant sets common provisioner receiver fields and
// the services and sessions needed to provision.
func (p *noobaaS3Provisioner) initializeCreateOrGrant(options *apibkt.BucketOptions) error {
	glog.V(2).Infof("initializing and setting CreateOrGrant services")
	// set the bucket name
	p.bucketName = options.BucketName

	// get the OBC and its storage class
	obc := options.ObjectBucketClaim
	scName := options.ObjectBucketClaim.Spec.StorageClassName
	sc, err := p.getClassByNameForBucket(scName)
	if err != nil {
		glog.Errorf("failed to get storage class for OBC \"%s/%s\": %v", obc.Namespace, obc.Name, err)
		return err
	}

	// check for bkt user access policy vs. bkt owner policy based on SC
	p.setCreateBucketUserOptions(obc, sc)

	// set the aws session and s3 service from the storage class
	err = p.setNoobaaClient(sc)
	if err != nil {
		return fmt.Errorf("error using OBC \"%s/%s\": %v", obc.Namespace, obc.Name, err)
	}

	return nil
}

// initializeUserAndPolicy sets commonly used provisioner
// receiver fields, generates a unique username and calls
// handleUserandPolicy.
func (p *noobaaS3Provisioner) initializeNoobaaAccount() error {

	// use owner account by default
	var accountEmail = p.nbConnInfo.Email
	if p.bktCreateUser == "yes" {
		for ok := false; !ok; {
			// Create a new noobaa account using the name of the bucket and set
			// access and attach policy for bucket and user
			p.bucketUserName = p.bucketName + randomString(5) + "@ob.provisioner"
			err := p.nbClient.CreateAccountForProvisioner(p.bucketUserName, p.bucketName)
			if err != nil {
				if nbErr, ok := err.(*NoobaaRPCError); ok {
					if nbErr.RPCCode == "ACCOUNT_ALREADY_EXIST" {
						ok = false
					}
				}
				return err
			}
			ok = true
			accountEmail = p.bucketUserName
		}
	}

	// get access and secret keys for the created account
	accessKey, secretKey, err := p.nbClient.GetAccountAccessKeys(accountEmail)
	if err != nil {
		return err
	}
	p.bucketUserAccessID = accessKey
	p.bucketUserSecretKey = secretKey
	return nil
}

func (p *noobaaS3Provisioner) checkIfUserExists(name string) bool {

	input := &awsuser.GetUserInput{
		UserName: aws.String(name),
	}

	_, err := p.iamsvc.GetUser(input)
	if err != nil {
		if err.(awserr.Error).Code() == awsuser.ErrCodeEntityAlreadyExistsException {
			return true
		}
		return false
	}

	return false
}

// Provision creates an aws s3 bucket and returns a connection info
// representing the bucket's endpoint and user access credentials.
// Programming Note: _all_ methods on "noobaaS3Provisioner" called directly
//   or indirectly by `Provision` should use pointer receivers. This allows
//   all supporting methods to set receiver fields where convenient. An
//   alternative (arguably better) would be for all supporting methods
//   to take value receivers and functionally return back to `Provision`
//   receiver fields they need set. The first approach is easier for now.
func (p noobaaS3Provisioner) Provision(options *apibkt.BucketOptions) (*v1alpha1.ObjectBucket, error) {

	// initialize and set the AWS services and commonly used variables
	err := p.initializeCreateOrGrant(options)
	if err != nil {
		return nil, err
	}

	// create the bucket
	glog.Infof("Creating bucket %q", p.bucketName)
	err = p.createBucket(p.bucketName)
	if err != nil {
		err = fmt.Errorf("error creating bucket %q: %v", p.bucketName, err)
		glog.Errorf(err.Error())
		return nil, err
	}

	err = p.initializeNoobaaAccount()
	if err != nil {
		return nil, err
	}

	// returned ob with connection info
	return p.rtnObjectBkt(p.bucketName), nil
}

// Grant attaches to an existing aws s3 bucket and returns a connection info
// representing the bucket's endpoint and user access credentials.
func (p noobaaS3Provisioner) Grant(options *apibkt.BucketOptions) (*v1alpha1.ObjectBucket, error) {

	// initialize and set the AWS services and commonly used variables
	err := p.initializeCreateOrGrant(options)
	if err != nil {
		return nil, err
	}

	// check and make sure the bucket exists
	glog.Infof("Checking for existing bucket %q", p.bucketName)

	// DZDZ TODO: check bucket exists in nooba
	if !p.nbClient.checkIfBucketExists(p.bucketName) {
		return nil, fmt.Errorf("bucket %s does not exist", p.bucketName)
	}

	// Bucket does exist, attach new user and policy wrapper
	// calling initializeUserAndPolicy
	// TODO: we currently are catching an error that is always nil
	_ = p.initializeNoobaaAccount()

	// returned ob with connection info
	// TODO: assuming this is the same Green vs Brown?
	return p.rtnObjectBkt(p.bucketName), nil
}

// Delete the bucket and all its objects.
// Note: only called when the bucket's reclaim policy is "delete".
func (p noobaaS3Provisioner) Delete(ob *v1alpha1.ObjectBucket) error {
	// DZDZ - for now we only revoke and not deleting the objects
	// set receiver fields from OB data
	p.bucketName = ob.Spec.Endpoint.BucketName
	p.bucketUserName = ob.Spec.AdditionalState[obStateUser]
	scName := ob.Spec.StorageClassName
	glog.Infof("Revoking access to bucket %q for OB %q", p.bucketName, ob.Name)

	// get the OB and its storage class
	sc, err := p.getClassByNameForBucket(scName)
	if err != nil {
		return fmt.Errorf("failed to get storage class for OB %q: %v", ob.Name, err)
	}

	// set the aws session and s3 service from the storage class
	err = p.setNoobaaClient(sc)
	if err != nil {
		return fmt.Errorf("error using OB %q: %v", ob.Name, err)
	}

	err = p.nbClient.DeleteAccount(p.bucketUserName)
	if err != nil {
		// We are currently only logging
		// because if failure do not want to stop
		// deletion of bucket
		glog.Errorf("Failed to delete account in noobaa - manual clean up required")
		//return fmt.Errorf("Error deleting Policy and/or User %v", err)
	}

	// No Deletion of Bucket or Content in Brownfield
	return nil

	// // set receiver fields from OB data
	// p.bucketName = ob.Spec.Endpoint.BucketName
	// p.bucketUserName = ob.Spec.AdditionalState[obStateUser]
	// scName := ob.Spec.StorageClassName
	// glog.Infof("Deleting bucket %q for OB %q", p.bucketName, ob.Name)

	// // get the OB and its storage class
	// sc, err := p.getClassByNameForBucket(scName)
	// if err != nil {
	// 	return fmt.Errorf("failed to get storage class for OB %q: %v", ob.Name, err)
	// }

	// // set the aws session and s3 service from the storage class
	// err = p.setNoobaaClient(sc)
	// if err != nil {
	// 	return fmt.Errorf("error using OB %q: %v", ob.Name, err)
	// }

	// // Delete IAM Policy and User
	// err = p.handleUserAndPolicyDeletion(p.bucketName)
	// if err != nil {
	// 	// We are currently only logging
	// 	// because if failure do not want to stop
	// 	// deletion of bucket
	// 	glog.Errorf("Failed to delete Policy and/or User - manual clean up required")
	// 	//return fmt.Errorf("Error deleting Policy and/or User %v", err)
	// }

	// // Delete Bucket
	// iter := s3manager.NewDeleteListIterator(p.s3svc, &s3.ListObjectsInput{
	// 	Bucket: aws.String(p.bucketName),
	// })

	// glog.V(2).Infof("Deleting all objects in bucket %q (from OB %q)", p.bucketName, ob.Name)
	// err = s3manager.NewBatchDeleteWithClient(p.s3svc).Delete(aws.BackgroundContext(), iter)
	// if err != nil {
	// 	return fmt.Errorf("Error deleting objects from bucket %q: %v", p.bucketName, err)
	// }

	// glog.V(2).Infof("Deleting empty bucket %q from OB %q", p.bucketName, ob.Name)
	// _, err = p.s3svc.DeleteBucket(&s3.DeleteBucketInput{
	// 	Bucket: aws.String(p.bucketName),
	// })
	// if err != nil {
	// 	return fmt.Errorf("Error deleting empty bucket %q: %v", p.bucketName, err)
	// }
	// glog.Infof("Deleted bucket %q from OB %q", p.bucketName, ob.Name)

	// return nil
}

// Revoke removes a user, policy and access keys from an existing bucket.
func (p noobaaS3Provisioner) Revoke(ob *v1alpha1.ObjectBucket) error {
	// set receiver fields from OB data
	p.bucketName = ob.Spec.Endpoint.BucketName
	p.bucketUserName = ob.Spec.AdditionalState[obStateUser]
	scName := ob.Spec.StorageClassName
	glog.Infof("Revoking access to bucket %q for OB %q", p.bucketName, ob.Name)

	// get the OB and its storage class
	sc, err := p.getClassByNameForBucket(scName)
	if err != nil {
		return fmt.Errorf("failed to get storage class for OB %q: %v", ob.Name, err)
	}

	// set the aws session and s3 service from the storage class
	err = p.setNoobaaClient(sc)
	if err != nil {
		return fmt.Errorf("error using OB %q: %v", ob.Name, err)
	}

	err = p.nbClient.DeleteAccount(p.bucketUserName)
	if err != nil {
		// We are currently only logging
		// because if failure do not want to stop
		// deletion of bucket
		glog.Errorf("Failed to delete account in noobaa - manual clean up required")
		//return fmt.Errorf("Error deleting Policy and/or User %v", err)
	}

	// No Deletion of Bucket or Content in Brownfield
	return nil
}

// create k8s config and client for the runtime-controller.
// Note: panics on errors.
func createConfigAndClientOrDie(masterurl, kubeconfig string) (*restclient.Config, *kubernetes.Clientset) {
	config, err := clientcmd.BuildConfigFromFlags(masterurl, kubeconfig)
	if err != nil {
		glog.Fatalf("Failed to create config: %v", err)
	}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		glog.Fatalf("Failed to create client: %v", err)
	}
	return config, clientset
}

func main() {
	defer glog.Flush()
	syscall.Umask(0)

	handleFlags()

	glog.Infof("NooBaa S3 Provisioner - main")
	glog.V(2).Infof("flags: kubeconfig=%q; masterURL=%q", kubeconfig, masterURL)

	config, clientset := createConfigAndClientOrDie(masterURL, kubeconfig)

	stopCh := handleSignals()

	s3Prov := noobaaS3Provisioner{}
	s3Prov.clientset = clientset

	// Create and run the s3 provisioner controller.
	// It implements the Provisioner interface expected by the bucket
	// provisioning lib.
	S3ProvisionerController, err := newNoobaaS3Provisioner(config, s3Prov)
	if err != nil {
		glog.Errorf("killing AWS S3 provisioner, error initializing library controller: %v", err)
		os.Exit(1)
	}
	glog.V(2).Infof("main: running %s provisioner...", provisionerName)
	S3ProvisionerController.Run()

	<-stopCh
	glog.Infof("main: %s provisioner exited.", provisionerName)
}

// --kubeconfig and --master are set in the controller-runtime's config
// package's init(). Set global kubeconfig and masterURL variables depending
// on flag values or env variables.
// Note: `alsologtostderr` *must* be specified on the command line to see
//   provisioner and bucket library logging. Setting it here does not affect
//   the lib because its init() function has already run.
func handleFlags() {

	if !flag.Parsed() {
		flag.Parse()
	}

	flag.VisitAll(func(f *flag.Flag) {
		if f.Name == "kubeconfig" {
			kubeconfig = flag.Lookup(f.Name).Value.String()
			if kubeconfig == "" {
				kubeconfig = os.Getenv("KUBECONFIG")
			}
			return
		}
		if f.Name == "master" {
			masterURL = flag.Lookup(f.Name).Value.String()
			if masterURL == "" {
				masterURL = os.Getenv("MASTER")
			}
			return
		}
	})
}

// Shutdown gracefully on system signals.
func handleSignals() <-chan struct{} {
	sigCh := make(chan os.Signal)
	stopCh := make(chan struct{})
	go func() {
		signal.Notify(sigCh)
		<-sigCh
		close(stopCh)
		os.Exit(1)
	}()
	return stopCh
}
