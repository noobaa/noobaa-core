package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"runtime/pprof"
	"strconv"
	"sync"

	"github.com/noobaa/noobaa-core/go/internal/goutils"
)

var flagClient = flag.String("client", "", "run client")
var flagConcur = flag.Int("concur", 1, "concurrent client requests")
var flagSize = flag.Int("size", 1, "request size in MB")
var flagBuf = flag.Int("buf", 128*1024, "memory buffer size in bytes")
var flagPort = flag.Int("port", 50505, "tcp port to use")
var flagSSL = flag.Bool("ssl", false, "use ssl")
var flagProf = flag.String("prof", "", "write cpu profile to file")

type Speedometer = goutils.Speedometer

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
	var addr string
	var client *http.Client
	var speedometer Speedometer

	host := *flagClient + ":" + strconv.Itoa(*flagPort)
	if *flagSSL {
		addr = "https://" + host
		client = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: true,
				},
			},
		}
	} else {
		addr = "http://" + host
		client = &http.Client{}
	}

	speedometer.Init()

	wait := sync.WaitGroup{}
	wait.Add(*flagConcur)
	for i := 0; i < *flagConcur; i++ {
		go runClientWorker(addr, client, &speedometer, &wait)
	}
	wait.Wait()
}

func runClientWorker(addr string, client *http.Client, speedometer *Speedometer, wait *sync.WaitGroup) {
	defer wait.Done()
	for {
		req, err := http.NewRequest("GET", addr, nil)
		fatal(err)
		res, err := client.Do(req)
		fatal(err)
		err = readBody(res.Body, speedometer)
		fatal(err)
	}
}

func runServer() {
	var speedometer Speedometer
	speedometer.Init()
	server := &http.Server{
		Addr: ":" + strconv.Itoa(*flagPort),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var err error
			err = r.Body.Close()
			fatal(err)
			err = writeBody(w, *flagSize*1024*1024, &speedometer)
			fatal(err)
		}),
	}
	if *flagSSL {
		cert, err := goutils.GenerateCert()
		fatal(err)
		server.TLSConfig = &tls.Config{Certificates: []tls.Certificate{*cert}}
		server.ListenAndServeTLS("", "")
	} else {
		fmt.Println("Listening on port", *flagPort)
		server.ListenAndServe()
	}
}

func writeBody(body http.ResponseWriter, size int, speedometer *Speedometer) error {
	buf := make([]byte, *flagBuf)
	n := 0
	for n < size {
		nwrite, err := body.Write(buf)
		if err != nil {
			return err
		}
		n += nwrite
		speedometer.Update(uint64(nwrite))
	}
	return nil
}

func readBody(body io.ReadCloser, speedometer *Speedometer) error {
	defer body.Close()
	buf := make([]byte, *flagBuf)
	for {
		nread, err := body.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		speedometer.Update(uint64(nread))
	}
	return nil
}

func fatal(err error) {
	if err != nil {
		log.Panic(err)
	}
}
