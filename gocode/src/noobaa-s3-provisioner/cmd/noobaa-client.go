package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
)

// noobaa services port
const (
	defaultPort      = "8443"
	mdPort           = "8444"
	bgPort           = "8445"
	hostedAgetnsPort = "8446"
)

// map api to service
var noobaaServicePort = map[string]string{
	"object_api":        mdPort,
	"func_api":          mdPort,
	"scrubber_api":      bgPort,
	"hosted_agents_api": hostedAgetnsPort,
}

// NoobaaClient is a client to make rpc requests from noobaa server
type NoobaaClient struct {
	endpoint  string
	authToken string
}

//NoobaaRPCError holds the rpc code and error message returned from noobaa
type NoobaaRPCError struct {
	RPCCode string `json:"rpc_code"`
	Message string
}

func (e *NoobaaRPCError) Error() string {
	return fmt.Sprintf("NooBaa request error: rpc_code:[%s] message:[%s]", e.RPCCode, e.Message)
}

type noobaaResponse struct {
	Reply json.RawMessage `json:"reply"`
	Error NoobaaRPCError  `json:"error"`
}

// NoobaaConnectionInfo - holds information for noobaa client to create a connection
type NoobaaConnectionInfo struct {
	Endpoint   string
	SystemName string
	Email      string
	Password   string
}

// NewNoobaaClient returns a new authenticated client or error
func NewNoobaaClient(connInfo NoobaaConnectionInfo) (*NoobaaClient, error) {
	nbClient := &NoobaaClient{}
	nbClient.endpoint = connInfo.Endpoint
	params := fmt.Sprintf(`{"role": "admin","system": "%s", "email": "%s", "password": "%s"}`,
		connInfo.SystemName, connInfo.Email, connInfo.Password)
	reply, err := nbClient.MakeRequest("auth_api", "create_auth", params)
	if err != nil {
		return nil, err
	}
	var authReply struct {
		Token string
	}
	json.Unmarshal(reply, &authReply)

	nbClient.authToken = authReply.Token
	return nbClient, nil
}

// MakeRequest send any request to noobaa server
// pass api, method and params according to api schema
// returns error or reply as json in []bytes
func (c *NoobaaClient) MakeRequest(api string, method string, params string) ([]byte, error) {
	// build json request
	jsonBody := []byte(fmt.Sprintf(`{"api": "%s","method": "%s","params": %s, "auth_token": "%s"}`, api, method, params, c.authToken))
	port, ok := noobaaServicePort[api]
	if !ok {
		port = defaultPort
	}
	url := "https://" + c.endpoint + ":" + port + "/rpc"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	// send request to noobaa
	fmt.Printf("NoobaaClient: RPC REQUEST: %s.%s(%s)\n", api, method, params)
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("got error on makeRequest jsonBody=%s. error=%s\n", string(jsonBody), err)
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)

	fmt.Printf("NoobaaClient: RPC RESPONSE: %s\n", string(body))
	// decode noobaa response
	var marsheledResp noobaaResponse
	json.Unmarshal(body, &marsheledResp)

	// fail on error
	if marsheledResp.Error.Message != "" {
		return nil, &marsheledResp.Error
	}

	// return reply json
	return marsheledResp.Reply, nil
}

/////////////////////// Bucket Api functions

// CreateBucket creates a bucket in noobaa with the default placement policy
func (c *NoobaaClient) CreateBucket(bucketName string) error {
	params := fmt.Sprintf(`{"name": "%s"}`, bucketName)
	_, err := c.MakeRequest("bucket_api", "create_bucket", params)
	if err != nil {
		return err
	}
	return nil
}

// CreateAccountForProvisioner creates a new account in noobaa
func (c *NoobaaClient) CreateAccountForProvisioner(accountName string, allowedBucket string) error {
	params := fmt.Sprintf(`{"name": "%s", 
							"email": "%s", 
							"has_login": false, 
							"s3_access": true,
							"allow_bucket_creation" :false,
							"default_pool" :"first.pool",
							"allowed_buckets": {
								"full_permission": false,
								"permission_list": ["%s"]
							}
							}`, accountName, accountName, allowedBucket)

	_, err := c.MakeRequest("account_api", "create_account", params)
	if err != nil {
		return err
	}
	return nil
}

// GetAccountAccessKeys returns the access keys for the giver account
func (c *NoobaaClient) GetAccountAccessKeys(accountEmail string) (string, string, error) {
	params := fmt.Sprintf(`{"email": "%s"}`, accountEmail)
	reply, err := c.MakeRequest("account_api", "read_account", params)
	if err != nil {
		return "", "", err
	}
	var accReply struct {
		AccessKeys []struct {
			AccessKey string `json:"access_key"`
			SecretKey string `json:"secret_key"`
		} `json:"access_keys"`
	}
	json.Unmarshal(reply, &accReply)
	return accReply.AccessKeys[0].AccessKey, accReply.AccessKeys[0].SecretKey, nil
}

// DeleteAccount deletes an account
func (c *NoobaaClient) DeleteAccount(accountEmail string) error {
	params := fmt.Sprintf(`{"email": "%s"}`, accountEmail)
	_, err := c.MakeRequest("account_api", "delete_account", params)
	if err != nil {
		fmt.Println("got error when deleting account", err)
		return err
	}
	return nil
}

func (c *NoobaaClient) checkIfBucketExists(bucketName string) bool {

	params := fmt.Sprintf(`{"name": "%s"}`, bucketName)

	_, err := c.MakeRequest("bucket_api", "read_bucket", params)
	if err != nil {
		if err.(*NoobaaRPCError).RPCCode == "NO_SUCH_BUCKET" {
			return false
		}
		return false
	}

	return true
}

// func main() {
// 	fmt.Println("DZDZ - starting")
// 	ci := NoobaaConnectionInfo{Endpoint: "13.74.144.104",
// 		Email:      "demo@noobaa.com",
// 		Password:   "DeMo1",
// 		SystemName: "noobaa",
// 	}
// 	client, err := NewNoobaaClient(ci)
// 	if err != nil {
// 		fmt.Println("got error", err)
// 		os.Exit(1)
// 	}

// 	// reply, err := client.MakeRequest("system_api", "read_system", "{}")
// 	// err = client.CreateBucket("dzdz-bucket")
// 	// err = client.CreateAccountForProvisioner("dzdz-bucket-35682@ob.provisioner", "dzdz-bucket")
// 	b := client.checkIfBucketExists("dzdz-bucket")
// 	if b {
// 		println("dzdz-bucket exists")
// 	}
// 	err = client.DeleteAccount("dzdz-bucket-35682@ob.provisioner")
// 	if err != nil {
// 		fmt.Println("got error", err)
// 		os.Exit(1)
// 	}
// 	fmt.Println("account dzdz-bucket-35682@ob.provisioner deleted")
// }
