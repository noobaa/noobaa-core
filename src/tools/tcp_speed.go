package main

import (
	"bufio"
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
	"time"
)

var port = flag.Int("port", 50505, "tcp port to use")
var prof = flag.String("prof", "", "write cpu profile to file")
var client = flag.Bool("client", false, "run client")
var bufsize = flag.Int("size", 1024*1024, "memory buffer size")
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
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(*port))
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
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(*port))
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
