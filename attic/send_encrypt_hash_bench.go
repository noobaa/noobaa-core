package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha1"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"runtime/pprof"
	"time"
)

const port string = ":4848"
const hashMarker uint32 = 0xFFFFFFFF

var prof = flag.String("prof", "", "write cpu profile to file")
var sendFile = flag.String("send", "", "file to send")

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
	if *sendFile != "" {
		runSender(*sendFile)
	} else {
		runReceiver()
	}
}

func runSender(fileName string) {
	fmt.Println("Sending", fileName, "to 127.0.0.1"+port)
	conn, err := net.Dial("tcp", "127.0.0.1"+port)
	fatal(err)
	file, err := os.Open(fileName)
	fatal(err)
	buf := make([]byte, 1024*1024)
	chanCipher := make(chan []byte, 8)
	chanSend := make(chan []byte, 8)
	chanDone := make(chan int)
	chanHash := make(chan []byte, 8)
	shaSum := sha1.New()

	go func() {
		i := 0
		for data := range chanCipher {
			// fmt.Printf("Encrypt chunk %d len %d \n", i, len(data))
			i++
			cipherKey := make([]byte, 32)
			blockCipher, err := aes.NewCipher(cipherKey)
			fatal(err)
			cipherIv := make([]byte, blockCipher.BlockSize())
			dataEncrypted := make([]byte, len(data))
			streamCipher := cipher.NewCTR(blockCipher, cipherIv)
			streamCipher.XORKeyStream(dataEncrypted, data)
			chanSend <- dataEncrypted
		}
		close(chanSend)
	}()

	go func() {
		i := 0
		for data := range chanSend {
			// fmt.Printf("Sending chunk %d len %d\n", i, len(data))
			i++
			err := binary.Write(conn, binary.BigEndian, uint32(len(data)))
			fatal(err)
			_, err = conn.Write(data)
			fatal(err)
		}
		chanDone <- 1
	}()

	go func() {
		i := 0
		for data := range chanHash {
			// fmt.Printf("Hashing chunk %d len %d\n", i, len(data))
			i++
			_, err := shaSum.Write(data)
			fatal(err)
		}
		chanDone <- 1
	}()

	for {
		count, err := io.ReadAtLeast(file, buf, len(buf))
		if err == io.EOF {
			break
		}
		if err != io.ErrUnexpectedEOF {
			fatal(err)
		}
		data := buf[:count]
		chanCipher <- data
		chanHash <- data
	}

	// close to signal there's no more data
	close(chanCipher)
	close(chanHash)
	// wait for workers to finish
	<-chanDone
	<-chanDone

	err = binary.Write(conn, binary.BigEndian, hashMarker)
	fatal(err)
	shaVal := shaSum.Sum(nil)
	_, err = conn.Write(shaVal)
	fatal(err)
	fmt.Printf("Done. SHA1 %x\n", shaVal)

	conn.Close()
	file.Close()
}

func runReceiver() {
	listener, err := net.Listen("tcp", port)
	fatal(err)
	fmt.Println("Listening on port", port)
	stop := make(chan int, 1)
	for {
		conn, err := listener.Accept()
		// before failing on the error, check if stop was triggered
		// adding default case will cause it not to block on the stop channel
		select {
		case <-stop:
			return
		default:
		}
		fatal(err)
		reader := conn //bufio.NewReaderSize(conn, 1024*1024)
		shaBuf := make([]byte, sha1.Size)
		go func() {
			nbytes := 0
			startTime := time.Now()
			shaSum := sha1.New()
			i := 0
			for {
				var chunkLen uint32
				err := binary.Read(reader, binary.BigEndian, &chunkLen)
				if err == io.EOF {
					break
				}
				fatal(err)
				if chunkLen == hashMarker {
					_, err := io.ReadAtLeast(reader, shaBuf, len(shaBuf))
					fatal(err)
					// fmt.Printf("Receiving hash %x\n", shaBuf)
				} else {
					ilen := int(chunkLen)
					// fmt.Printf("Receiving chunk %d len %d\n", i, ilen)
					i++
					encryptedData := make([]byte, chunkLen)
					data := make([]byte, chunkLen)
					_, err := io.ReadAtLeast(reader, encryptedData, ilen)
					fatal(err)
					cipherKey := make([]byte, 32)
					blockCipher, err := aes.NewCipher(cipherKey)
					fatal(err)
					cipherIv := make([]byte, blockCipher.BlockSize())
					streamCipher := cipher.NewCTR(blockCipher, cipherIv)
					streamCipher.XORKeyStream(data, encryptedData)
					nbytes += ilen
					_, err = shaSum.Write(data)
					fatal(err)
				}
			}
			shaVal := shaSum.Sum(nil)
			if !bytes.Equal(shaBuf, shaVal) {
				fmt.Printf("ERROR: Bad sha1 %x expected %x\n", shaVal, shaBuf)
			}
			took := time.Since(startTime)
			fmt.Println(
				"Took", took.Seconds(), "seconds",
				"Size", nbytes, "Bytes",
				"Speed", float64(nbytes)/1024/1024/took.Seconds(), "MB/sec")
			stop <- 1
			listener.Close()
		}()
	}
}

func fatal(err error) {
	if err != nil {
		log.Panic(err)
	}
}
