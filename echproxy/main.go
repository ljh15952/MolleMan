// Command echproxy is a local TLS-terminating HTTP proxy that performs DNS
// resolution over DoH and, where the destination publishes an ECH config,
// connects upstream with Encrypted Client Hello so the real SNI is encrypted
// on the wire.
//
// It exists so a browser (e.g. WebView2) on a managed device — where Chromium's
// own secure DNS is policy-disabled — can still reach sites with the SNI hidden:
// the browser talks plain TLS to 127.0.0.1 (never leaves the machine) and this
// proxy does the real DoH + ECH handshake to the upstream itself.
//
//	browser --TLS--> 127.0.0.1:PORT (this proxy) --DoH+ECH--> origin
//
// The proxy signs a per-host leaf cert with an in-memory local CA; the browser
// is expected to accept it (WebView2: ServerCertificateErrorDetected).
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// DoH resolver (A + HTTPS/ECH), with a small TTL cache.
// ---------------------------------------------------------------------------

type dnsAnswer struct {
	Type int    `json:"type"`
	Data string `json:"data"`
	TTL  int    `json:"TTL"`
}

type cacheItem[T any] struct {
	val    T
	expiry time.Time
}

type resolver struct {
	hc  *http.Client
	mu  sync.Mutex
	ip  map[string]cacheItem[string]
	ech map[string]cacheItem[[]byte]
}

func newResolver() *resolver {
	// Bootstrap the DoH client straight to 1.1.1.1 by IP so no plaintext
	// system DNS lookup happens for the resolver itself.
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, network, "1.1.1.1:443")
		},
		ForceAttemptHTTP2: true,
	}
	return &resolver{
		hc:  &http.Client{Transport: tr, Timeout: 10 * time.Second},
		ip:  map[string]cacheItem[string]{},
		ech: map[string]cacheItem[[]byte]{},
	}
}

func (r *resolver) query(name string, typ int) ([]dnsAnswer, error) {
	u := fmt.Sprintf("https://cloudflare-dns.com/dns-query?name=%s&type=%d", url.QueryEscape(name), typ)
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("accept", "application/dns-json")
	resp, err := r.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Answer []dnsAnswer `json:"Answer"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Answer, nil
}

// resolveIP returns an A-record address for host, caching by TTL. Falls back to
// the system resolver only if DoH fails, so browsing never hard-breaks.
func (r *resolver) resolveIP(host string) (string, error) {
	r.mu.Lock()
	if c, ok := r.ip[host]; ok && time.Now().Before(c.expiry) {
		r.mu.Unlock()
		return c.val, nil
	}
	r.mu.Unlock()

	ans, err := r.query(host, 1) // A
	if err == nil {
		for _, a := range ans {
			if a.Type == 1 && net.ParseIP(a.Data) != nil {
				r.mu.Lock()
				r.ip[host] = cacheItem[string]{a.Data, time.Now().Add(ttl(a.TTL))}
				r.mu.Unlock()
				return a.Data, nil
			}
		}
	}
	// Fallback: system resolver (leaks the name to local DNS, but keeps things working).
	ips, serr := net.DefaultResolver.LookupHost(context.Background(), host)
	if serr == nil {
		for _, ip := range ips {
			if net.ParseIP(ip).To4() != nil {
				return ip, nil
			}
		}
		if len(ips) > 0 {
			return ips[0], nil
		}
	}
	if err != nil {
		return "", err
	}
	return "", fmt.Errorf("no A record for %s", host)
}

// resolveECH returns the decoded ECHConfigList for host, or nil if the host
// publishes none. A nil result is cached too, so non-ECH hosts aren't re-queried.
func (r *resolver) resolveECH(host string) []byte {
	r.mu.Lock()
	if c, ok := r.ech[host]; ok && time.Now().Before(c.expiry) {
		r.mu.Unlock()
		return c.val
	}
	r.mu.Unlock()

	var out []byte
	if ans, err := r.query(host, 65); err == nil { // HTTPS
		for _, a := range ans {
			if a.Type != 65 {
				continue
			}
			for _, tok := range strings.Fields(a.Data) {
				if strings.HasPrefix(tok, "ech=") {
					if b, derr := base64.StdEncoding.DecodeString(strings.TrimPrefix(tok, "ech=")); derr == nil {
						out = b
					}
				}
			}
		}
	}
	r.mu.Lock()
	r.ech[host] = cacheItem[[]byte]{out, time.Now().Add(5 * time.Minute)}
	r.mu.Unlock()
	return out
}

func ttl(sec int) time.Duration {
	if sec < 30 {
		sec = 30
	}
	if sec > 3600 {
		sec = 3600
	}
	return time.Duration(sec) * time.Second
}

// ---------------------------------------------------------------------------
// In-memory local CA and per-host leaf certificates for the MITM side.
// ---------------------------------------------------------------------------

type certMaker struct {
	caCert *x509.Certificate
	caKey  *ecdsa.PrivateKey
	mu     sync.Mutex
	cache  map[string]*tls.Certificate
}

func newCertMaker() (*certMaker, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: "echproxy local CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	caCert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	return &certMaker{caCert: caCert, caKey: key, cache: map[string]*tls.Certificate{}}, nil
}

func (m *certMaker) get(host string) (*tls.Certificate, error) {
	if host == "" {
		host = "localhost"
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.cache[host]; ok {
		return c, nil
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = []net.IP{ip}
	} else {
		tmpl.DNSNames = []string{host}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, m.caCert, &key.PublicKey, m.caKey)
	if err != nil {
		return nil, err
	}
	cert := &tls.Certificate{Certificate: [][]byte{der, m.caCert.Raw}, PrivateKey: key}
	m.cache[host] = cert
	return cert, nil
}

// ---------------------------------------------------------------------------
// Proxy.
// ---------------------------------------------------------------------------

type onceListener struct {
	c    net.Conn
	mu   sync.Mutex
	used bool
}

func (l *onceListener) Accept() (net.Conn, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.used {
		return nil, io.EOF
	}
	l.used = true
	return l.c, nil
}
func (l *onceListener) Close() error   { return nil }
func (l *onceListener) Addr() net.Addr { return l.c.LocalAddr() }

func main() {
	addr := flag.String("addr", "127.0.0.1:8899", "listen address for the proxy")
	echHostsFlag := flag.String("ech-hosts", "protect.ljh240310.date",
		"comma-separated hosts to MITM and dial with ECH; every other host is tunneled untouched")
	flag.Parse()

	// Only these hosts are terminated (MITM) so we can apply ECH to them. For any
	// other host we tunnel bytes through untouched, so the browser does its own
	// TLS -- real certificates, HSTS honored, no cert warnings. (MITM only helps
	// hosts that publish an ECH config anyway; for the rest it would merely break
	// HSTS sites while still exposing their SNI upstream.)
	mitm := map[string]bool{}
	for _, h := range strings.Split(*echHostsFlag, ",") {
		if h = strings.TrimSpace(strings.ToLower(h)); h != "" {
			mitm[h] = true
		}
	}

	cm, err := newCertMaker()
	if err != nil {
		log.Fatalf("CA init: %v", err)
	}
	res := newResolver()

	// Upstream transport: DoH-resolve, then dial with ECH where available.
	echTransport := &http.Transport{
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host, port = addr, "443"
			}
			ip, err := res.resolveIP(host)
			if err != nil {
				return nil, err
			}
			ech := res.resolveECH(host)
			conf := &tls.Config{ServerName: host, NextProtos: []string{"http/1.1"}}
			if len(ech) > 0 {
				conf.EncryptedClientHelloConfigList = ech
				conf.MinVersion = tls.VersionTLS13
			}
			raw, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip, port))
			if err != nil {
				return nil, err
			}
			tconn := tls.Client(raw, conf)
			if err := tconn.HandshakeContext(ctx); err != nil {
				raw.Close()
				return nil, fmt.Errorf("upstream TLS %s: %w", host, err)
			}
			cs := tconn.ConnectionState()
			log.Printf("upstream %-30s echOffered=%-5v echAccepted=%-5v tls=0x%x",
				host, len(ech) > 0, cs.ECHAccepted, cs.Version)
			return tconn, nil
		},
		TLSHandshakeTimeout: 15 * time.Second,
		IdleConnTimeout:     60 * time.Second,
	}

	// One reverse proxy for all MITM'd connections; target is taken per-request
	// from the Host header (each MITM conn carries exactly one origin host).
	rp := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = "https"
			req.URL.Host = req.Host
		},
		Transport: echTransport,
		ModifyResponse: func(resp *http.Response) error {
			// Never let a MITM'd origin pin HSTS in the browser, or a future visit
			// could refuse our local-CA cert.
			resp.Header.Del("Strict-Transport-Security")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			log.Printf("proxy error %s: %v", r.Host, e)
			w.WriteHeader(http.StatusBadGateway)
		},
	}

	// Plain HTTP (non-CONNECT) requests arrive with an absolute URL; forward as-is.
	httpRP := &httputil.ReverseProxy{
		Director:  func(req *http.Request) {},
		Transport: http.DefaultTransport,
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect {
			handleConnect(w, r, cm, rp, res, mitm)
			return
		}
		httpRP.ServeHTTP(w, r)
	})

	srv := &http.Server{Addr: *addr, Handler: handler}
	log.Printf("echproxy listening on %s (DoH via 1.1.1.1, ECH where published)", *addr)
	log.Fatal(srv.ListenAndServe())
}

func handleConnect(w http.ResponseWriter, r *http.Request, cm *certMaker, rp *httputil.ReverseProxy, res *resolver, mitm map[string]bool) {
	host := r.Host
	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	hij, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	clientConn, _, err := hij.Hijack()
	if err != nil {
		return
	}
	if _, err := io.WriteString(clientConn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		clientConn.Close()
		return
	}

	// Only MITM the configured ECH hosts; tunnel everything else untouched.
	if !mitm[strings.ToLower(hostname)] {
		tunnel(clientConn, r.Host, res)
		return
	}

	tlsConf := &tls.Config{
		NextProtos: []string{"http/1.1"},
		GetCertificate: func(chi *tls.ClientHelloInfo) (*tls.Certificate, error) {
			name := chi.ServerName
			if name == "" {
				name = hostname
			}
			return cm.get(name)
		},
	}
	tconn := tls.Server(clientConn, tlsConf)
	if err := tconn.Handshake(); err != nil {
		tconn.Close()
		return
	}

	// Serve HTTP/1.1 over the terminated TLS conn; the reverse proxy forwards
	// each request upstream with DoH+ECH. Serve returns once the browser closes
	// the tunnel.
	(&http.Server{Handler: rp}).Serve(&onceListener{c: tconn})
}

// tunnel relays bytes between the browser and the origin without terminating TLS.
// The origin is resolved over DoH (so the name isn't leaked to local DNS), but
// the browser performs the end-to-end TLS handshake, so its own SNI is used and
// its normal certificate validation / HSTS apply.
func tunnel(client net.Conn, hostport string, res *resolver) {
	defer client.Close()
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		host, port = hostport, "443"
	}
	ip, err := res.resolveIP(host)
	if err != nil {
		log.Printf("tunnel resolve %s: %v", host, err)
		return
	}
	up, err := net.DialTimeout("tcp", net.JoinHostPort(ip, port), 10*time.Second)
	if err != nil {
		log.Printf("tunnel dial %s: %v", host, err)
		return
	}
	defer up.Close()
	log.Printf("tunnel    %-30s (passthrough, browser TLS)", host)
	done := make(chan struct{}, 2)
	go func() { io.Copy(up, client); done <- struct{}{} }()
	go func() { io.Copy(client, up); done <- struct{}{} }()
	<-done
}
