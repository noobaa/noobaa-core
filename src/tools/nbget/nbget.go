package main

import (
	"archive/tar"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

func main() {
	flag.Parse()
	URL := flag.Arg(0)
	x := New(URL)
	x.Main()
}

// NBGet struct for context
type NBGet struct {
	URL    string
	OutDir string
	Script string
	Body   io.ReadCloser
	Logger *log.Logger
}

type myError struct {
	Err error
	Msg string
}

func (e *myError) Error() string {
	if e.Err != nil {
		return fmt.Sprint(e.Msg, " FAILED caused by ", e.Err)
	}
	return fmt.Sprint(e.Msg)
}

// New initialize NBGet task
func New(URL string) *NBGet {
	x := new(NBGet)
	x.URL = URL
	x.OutDir = filepath.Join(os.TempDir(), "nbget-"+time.Now().Format("2006-01-02T15-04-05.000"))
	if runtime.GOOS == "windows" {
		x.Script = "run.bat"
	} else {
		x.Script = "run.sh"
	}
	x.Logger = log.New(os.Stdout, "[nbget] ", log.Ldate|log.Ltime|log.Lmicroseconds)
	return x
}

// Main runs the NBGet task and exit on error
func (x *NBGet) Main() {
	err := x.Run()
	if err != nil {
		x.Logger.Fatal(err)
	}
}

// Run runs the NBGet task and returns error if any
func (x *NBGet) Run() error {
	defer x.Close()

	err := x.GetURL()
	if err != nil {
		return err
	}

	err = x.PrepareOutDir()
	if err != nil {
		return err
	}

	err = x.Extract()
	if err != nil {
		return err
	}

	err = x.RunScript()
	if err != nil {
		return err
	}

	return nil
}

// GetURL gets the package from the server and returns a reader
func (x *NBGet) GetURL() error {
	if x.URL == "" {
		return &myError{nil, "Missing URL"}
	}
	x.Logger.Println("Get", x.URL, "...")

	// Request HTTP Get on the url
	res, err := http.Get(x.URL)
	if err != nil {
		return &myError{err, "HTTP Get"}
	}
	if res.StatusCode != 200 {
		res.Body.Close()
		return &myError{nil, "HTTP Status Code " + strconv.Itoa(res.StatusCode)}
	}

	// The response body will be used to read the package
	x.Body = res.Body

	// The server can reply with a header to determine
	// the script name to run in the package other than the defaults.
	scriptHeader := "nbget-script-" + runtime.GOOS
	script := res.Header.Get(http.CanonicalHeaderKey(scriptHeader))
	if script == "" {
		scriptHeader = "nbget-script"
		script = res.Header.Get(http.CanonicalHeaderKey(scriptHeader))
	}
	if script != "" {
		x.Logger.Println("Script header from server:", script)
		x.Script = script
	}

	return nil
}

// PrepareOutDir creates the output dir and cd into it
func (x *NBGet) PrepareOutDir() error {
	x.Logger.Println("PrepareOutDir", x.OutDir, "...")

	err := os.MkdirAll(x.OutDir, os.ModePerm)
	if err != nil {
		return &myError{err, "Mkdir"}
	}

	err = os.Chdir(x.OutDir)
	if err != nil {
		return &myError{err, "Chdir"}
	}

	return nil
}

// Extract writes the package entries to current working directory
// currently this assumes the package is tar.gz which allows on-the-fly streaming processing
// so the package is extracted from http body to output dir.
func (x *NBGet) Extract() error {
	x.Logger.Println("Extract ...")

	gz, err := gzip.NewReader(x.Body)
	if err != nil {
		return &myError{err, "Gzip"}
	}
	defer gz.Close()
	tr := tar.NewReader(gz)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return &myError{err, "Tar"}
		}

		// Prefix with "./" to enforce extract only under current dir.
		// In order to put files in other dirs the package should do so the executed script.
		fullName := filepath.FromSlash("./" + hdr.Name)
		dirName := filepath.Dir(fullName)
		baseName := filepath.Base(fullName)
		x.Logger.Println("File:", dirName, baseName, "("+strconv.FormatInt(hdr.Size, 10)+")")

		err = os.MkdirAll(dirName, os.ModePerm)
		if err != nil {
			return &myError{err, "Mkdir"}
		}
		file, err := os.OpenFile(fullName, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.ModePerm)
		if err != nil {
			return &myError{err, "Create File"}
		}
		_, err = io.Copy(file, tr)
		if err != nil {
			return &myError{err, "Write File"}
		}
		err = file.Close()
		if err != nil {
			return &myError{err, "Close File"}
		}
	}

	return nil
}

// RunScript runs a script from the package
func (x *NBGet) RunScript() error {
	x.Logger.Println("RunScript", x.Script, "...")

	// Make sure the script file exists
	_, err := os.Stat(x.Script)
	if err != nil {
		return &myError{err, "Stat Script"}
	}

	// Execute a shell with the script
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", "/c", x.Script)
	} else {
		cmd = exec.Command("bash", "-c", x.Script)
	}
	cmd.Stdout = os.Stdout
	err = cmd.Run()
	if err != nil {
		return &myError{err, "Exec Script"}
	}

	return nil
}

// Close closes the package
func (x *NBGet) Close() error {
	x.Logger.Println("Close ...")

	if x.Body != nil {
		x.Body.Close()
		x.Body = nil
	}

	if x.OutDir != "" {
		x.Logger.Println("Cleaning", x.OutDir, "...")
		err := os.RemoveAll(x.OutDir)
		if err != nil {
			// maybe short sleep and try RemoveAll again?
			x.Logger.Println("Remove Output Dir Failed", err)
		}
	}

	return nil
}
