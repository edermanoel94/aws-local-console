// Package aws builds AWS SDK v2 configuration and clients pointed at Floci, and
// provides the HTTP capture middleware and the Floci health client.
package aws

import (
	"net"
	"net/http"
	"sync"
	"time"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"

	"github.com/edermanoel/aws-dash-local/backend/internal/environments"
)

// ClientBuilder builds one SDK client (e.g. s3.NewFromConfig) from a config.
type ClientBuilder func(cfg sdkaws.Config) any

// Factory creates and caches SDK clients per (service, region).
type Factory struct {
	cfg        environments.Config
	httpClient *http.Client

	mu      sync.Mutex
	clients map[string]any
}

// NewFactory returns a client factory for the given configuration.
func NewFactory(cfg environments.Config) *Factory {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.MaxIdleConnsPerHost = 64
	transport.ResponseHeaderTimeout = 5 * time.Minute // Lambda cold starts on Floci pull images
	return &Factory{
		cfg:        cfg,
		httpClient: &http.Client{Transport: transport},
		clients:    map[string]any{},
	}
}

// Endpoint returns the Floci endpoint all clients talk to.
func (f *Factory) Endpoint() string { return f.cfg.FlociEndpoint }

// HTTPClient returns the shared HTTP client used for Floci.
func (f *Factory) HTTPClient() *http.Client { return f.httpClient }

// SDKConfig returns the base SDK configuration for a region.
//
// Retries are disabled on purpose: the console shows exactly the one HTTP
// exchange that happened, and a local emulator gains nothing from retrying.
func (f *Factory) SDKConfig(region string) sdkaws.Config {
	return sdkaws.Config{
		Region:       region,
		Credentials:  sdkaws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(f.cfg.AccessKeyID, f.cfg.SecretAccessKey, "")),
		BaseEndpoint: sdkaws.String(f.cfg.FlociEndpoint),
		HTTPClient:   f.httpClient,
		Retryer:      func() sdkaws.Retryer { return sdkaws.NopRetryer{} },
		// Floci accepts checksums, but only computing them when required keeps
		// raw requests readable and avoids aws-chunked bodies for PutObject.
		RequestChecksumCalculation: sdkaws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: sdkaws.ResponseChecksumValidationWhenRequired,
	}
}

// Client returns the cached client for (service, region), building it on first use.
func (f *Factory) Client(service, region string, build ClientBuilder) any {
	key := service + "|" + region
	f.mu.Lock()
	defer f.mu.Unlock()
	if client, ok := f.clients[key]; ok {
		return client
	}
	client := build(f.SDKConfig(region))
	f.clients[key] = client
	return client
}
