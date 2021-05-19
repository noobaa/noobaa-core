package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"os"
	"runtime/pprof"
	"strconv"
	"time"
)

var client = flag.Bool("client", false, "run client")
var ssl = flag.Bool("ssl", false, "use ssl")
var port = flag.Int("port", 50505, "tcp port to use")
var prof = flag.String("prof", "", "write cpu profile to file")
var bufsize = flag.Int("size", 128*1024, "memory buffer size")
var frame = flag.Bool("frame", false, "send/receive framed messages")

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

func runSender() {
	var conn net.Conn
	var err error
	if *ssl {
		config := &tls.Config{InsecureSkipVerify: true}
		conn, err = tls.Dial("tcp", "localhost:"+strconv.Itoa(*port), config)
	} else {
		conn, err = net.Dial("tcp", "localhost:"+strconv.Itoa(*port))
	}
	fatal(err)
	buf := make([]byte, *bufsize)
	var speedometer Speedometer
	speedometer.Init()
	for {
		if *frame {
			n := uint32(len(buf)) // uint32(float64(len(buf))*(1+rand.Float64())/8) * 4
			err := binary.Write(conn, binary.BigEndian, n)
			fatal(err)
			// nwrite, err := conn.Write(buf[0:n])
			nwrite, err := conn.Write(buf)
			if err == io.EOF {
				break
			}
			fatal(err)
			speedometer.Update(uint64(nwrite))

		} else {
			nwrite, err := conn.Write(buf)
			if err == io.EOF {
				break
			}
			fatal(err)
			speedometer.Update(uint64(nwrite))
		}
	}
	conn.Close()
}

func runReceiver() {
	var listener net.Listener
	var err error
	if *ssl {
		config := &tls.Config{Certificates: []tls.Certificate{GenerateCert()}}
		listener, err = tls.Listen("tcp", ":"+strconv.Itoa(*port), config)
	} else {
		listener, err = net.Listen("tcp", ":"+strconv.Itoa(*port))
	}
	fatal(err)
	fmt.Println("Listening on port", *port)
	conn, err := listener.Accept()
	fatal(err)
	listener.Close()
	// reader := conn
	reader := bufio.NewReaderSize(conn, *bufsize)
	buf := make([]byte, *bufsize)
	var speedometer Speedometer
	speedometer.Init()
	for {
		if *frame {
			var n uint32
			err := binary.Read(reader, binary.BigEndian, &n)
			if err == io.EOF {
				break
			}
			fatal(err)
			if int(n) > len(buf) {
				fatal(errors.New("Frame too big"))
			}
			nread, err := io.ReadAtLeast(reader, buf, int(n))
			if err == io.EOF {
				break
			}
			fatal(err)
			speedometer.Update(uint64(nread))
		} else {
			nread, err := reader.Read(buf)
			if err == io.EOF {
				break
			}
			fatal(err)
			speedometer.Update(uint64(nread))
		}
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
