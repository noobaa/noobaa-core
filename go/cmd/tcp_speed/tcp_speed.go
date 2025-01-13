package main

import (
	"bufio"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"runtime/pprof"
	"strconv"

	"github.com/noobaa/noobaa-core/go/internal/goutils"
)

type Speedometer = goutils.Speedometer

var flagClient = flag.String("client", "", "run client")
var flagSSL = flag.Bool("ssl", false, "use ssl")
var flagPort = flag.Int("port", 50505, "tcp port to use")
var flagProf = flag.String("prof", "", "write cpu profile to file")
var flagBuf = flag.Int("buf", 128*1024, "memory buffer size in bytes")
var flagFrame = flag.Bool("frame", false, "send/receive framed messages")

func main() {
	flag.Parse()
	if *flagProf != "" {
		f, err := os.Create(*flagProf)
		if err != nil {
			log.Fatal(err)
		}
		pprof.StartCPUProfile(f)
		defer pprof.StopCPUProfile()
	}
	if *flagClient != "" {
		runClient()
	} else {
		runServer()
	}
}

func runClient() {
	var conn net.Conn
	var err error
	host := *flagClient + ":" + strconv.Itoa(*flagPort)
	if *flagSSL {
		config := &tls.Config{InsecureSkipVerify: true}
		conn, err = tls.Dial("tcp", host, config)
	} else {
		conn, err = net.Dial("tcp", host)
	}
	fatal(err)
	buf := make([]byte, *flagBuf)
	var speedometer Speedometer
	speedometer.Init()
	for {
		if *flagFrame {
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

func runServer() {
	var listener net.Listener
	var err error
	address := ":" + strconv.Itoa(*flagPort)
	if *flagSSL {
		cert, err := goutils.GenerateCert()
		fatal(err)
		config := &tls.Config{Certificates: []tls.Certificate{*cert}}
		listener, err = tls.Listen("tcp", address, config)
	} else {
		listener, err = net.Listen("tcp", address)
	}
	fatal(err)
	fmt.Println("Listening on port", *flagPort)
	conn, err := listener.Accept()
	fatal(err)
	listener.Close()
	// reader := conn
	reader := bufio.NewReaderSize(conn, *flagBuf)
	buf := make([]byte, *flagBuf)
	var speedometer Speedometer
	speedometer.Init()
	for {
		if *flagFrame {
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

func fatal(err error) {
	if err != nil {
		log.Panic(err)
	}
}
