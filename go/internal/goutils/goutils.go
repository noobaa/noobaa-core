package goutils

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"time"
)

type SpeedBodyReader struct {
	io.ReadCloser
	n           uint64
	reqsize     uint64
	speedometer *Speedometer
}

func (r *SpeedBodyReader) Read(p []byte) (n int, err error) {
	if r.n > r.reqsize {
		return 0, io.EOF
	}
	l := uint64(len(p))
	r.n += l
	r.speedometer.Update(l)
	return len(p), nil
}

func (r *SpeedBodyReader) Close() error {
	return nil
}

// Speedometer is a speed measurement util
type Speedometer struct {
	bytes     uint64
	lastBytes uint64
	lastTime  time.Time
	inputChan chan uint64
}

// Init a speedometer
func (s *Speedometer) Init() {
	s.lastTime = time.Now()
	s.inputChan = make(chan uint64, 64*1024)
	go func() {
		for {
			bytes := <-s.inputChan
			s.bytes += bytes
			took := time.Since(s.lastTime).Seconds()
			if took >= 1 {
				fmt.Printf("%7.1f MB/sec \n", float64(s.bytes-s.lastBytes)/1024/1024/took)
				s.lastTime = time.Now()
				s.lastBytes = s.bytes
			}
		}
	}()
}

// Update a speedometer
func (s *Speedometer) Update(bytes uint64) {
	s.inputChan <- bytes
}

// GenerateCert generates a self signed TLS certificate
func GenerateCert() (*tls.Certificate, error) {

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
	if err != nil {
		return nil, err
	}

	certBytes, err := x509.CreateCertificate(rand.Reader, cert, cert, &privateKey.PublicKey, privateKey)
	if err != nil {
		return nil, err
	}

	certPEM := new(bytes.Buffer)
	err = pem.Encode(certPEM, &pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certBytes,
	})
	if err != nil {
		return nil, err
	}

	privateKeyPEM := new(bytes.Buffer)
	err = pem.Encode(privateKeyPEM, &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})
	if err != nil {
		return nil, err
	}

	tlsCert, err := tls.X509KeyPair(certPEM.Bytes(), privateKeyPEM.Bytes())
	if err != nil {
		return nil, err
	}

	return &tlsCert, nil
}
