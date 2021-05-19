package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"runtime/pprof"
	"strconv"
	"time"
)

var client = flag.Bool("client", false, "run client")
var ssl = flag.Bool("ssl", false, "use ssl")
var port = flag.Int("port", 50505, "tcp port to use")
var prof = flag.String("prof", "", "write cpu profile to file")
var reqsizeMB = flag.Int("size", 1024, "request size in MB")
var bufsize = flag.Int("buf", 128*1024, "memory buffer size")

func main() {
	flag.Parse()
	if *prof != "" {
		f, err := os.Create(*prof)
		if err != nil {
			log.Fatal(err)
		}
		pprof.StartCPUProfile(f)
		defer pprof.StopCPUProfile()
	}
	if *client {
		runSender()
	} else {
		runReceiver()
	}
}

type reqBodyReader struct {
	io.ReadCloser
	n           uint64
	reqsize     uint64
	speedometer *Speedometer
}

func (r *reqBodyReader) Read(p []byte) (n int, err error) {
	if r.n > r.reqsize {
		return 0, io.EOF
	}
	l := uint64(len(p))
	r.n += l
	r.speedometer.Update(l)
	return len(p), nil
}

func (r *reqBodyReader) Close() error {
	return nil
}

func runSender() {
	var addr string
	var client *http.Client
	var speedometer Speedometer

	if *ssl {
		addr = "https://localhost:" + strconv.Itoa(*port)
		client = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: true,
				},
			},
		}
	} else {
		addr = "http://localhost:" + strconv.Itoa(*port)
		client = &http.Client{}
	}

	speedometer.Init()

	for {
		req, err := http.NewRequest("PUT", addr, &reqBodyReader{
			reqsize:     uint64(*reqsizeMB * 1024 * 1024),
			speedometer: &speedometer,
		})
		fatal(err)
		res, err := client.Do(req)
		fatal(err)
		err = res.Body.Close()
		fatal(err)
	}
}

func runReceiver() {
	var speedometer Speedometer

	speedometer.Init()

	server := &http.Server{
		Addr: ":" + strconv.Itoa(*port),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for {
				buf := make([]byte, *bufsize)
				nread, err := r.Body.Read(buf)
				if err == io.EOF {
					break
				}
				fatal(err)
				speedometer.Update(uint64(nread))
			}
			w.WriteHeader(200)
		}),
	}

	if *ssl {
		server.TLSConfig = &tls.Config{Certificates: []tls.Certificate{GenerateCert()}}
		server.ListenAndServeTLS("", "")
	} else {
		fmt.Println("Listening on port", *port)
		server.ListenAndServe()
	}
}

// Speedometer is a speed measurement util
type Speedometer struct {
	bytes     uint64
	lastBytes uint64
	lastTime  time.Time
}

// Init a speedometer
func (s *Speedometer) Init() {
	s.lastTime = time.Now()
}

// Update a speedometer
func (s *Speedometer) Update(bytes uint64) {
	s.bytes += bytes
	took := time.Since(s.lastTime).Seconds()
	if took >= 1 {
		fmt.Printf("%7.1f MB/sec \n", float64(s.bytes-s.lastBytes)/1024/1024/took)
		s.lastTime = time.Now()
		s.lastBytes = s.bytes
	}
}

func fatal(err error) {
	if err != nil {
		log.Panic(err)
	}
}

// GenerateCert generates a self signed TLS certificate
func GenerateCert() tls.Certificate {

	cert := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{Organization: []string{"Acme Co"}},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().AddDate(1, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:              nil,
	}

	privateKey, err := rsa.GenerateKey(rand.Reader, 4096)
	fatal(err)

	certBytes, err := x509.CreateCertificate(rand.Reader, cert, cert, &privateKey.PublicKey, privateKey)
	fatal(err)

	certPEM := new(bytes.Buffer)
	fatal(pem.Encode(certPEM, &pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certBytes,
	}))

	privateKeyPEM := new(bytes.Buffer)
	fatal(pem.Encode(privateKeyPEM, &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}))

	tlsCert, err := tls.X509KeyPair(certPEM.Bytes(), privateKeyPEM.Bytes())
	fatal(err)

	return tlsCert
}
