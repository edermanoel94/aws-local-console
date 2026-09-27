// Package aws builds the AWS SDK v2 configuration and clients of the target
// the console operates (Floci or a real AWS account), and provides the HTTP
// capture middleware and the target health monitor.
package aws

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"

	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
)

// ClientBuilder builds one SDK client (e.g. s3.NewFromConfig) from a config.
type ClientBuilder func(cfg sdkaws.Config, target environments.Target) any

// Factory creates and caches SDK clients per (service, region).
type Factory struct {
	target        environments.Target
	flociEndpoint string
	base          sdkaws.Config
	httpClient    *http.Client

	mu      sync.Mutex
	clients map[string]any
}

// NewFactory returns a client factory for the given configuration.
//
// With TargetAWS the SDK default configuration is loaded: credentials come
// from the default chain and the region, when AWS_REGION is not set, from
// AWS_DEFAULT_REGION or the shared config profile.
func NewFactory(ctx context.Context, cfg environments.Config) (*Factory, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.MaxIdleConnsPerHost = 64
	transport.ResponseHeaderTimeout = 5 * time.Minute // Lambda cold starts on Floci pull images
	httpClient := &http.Client{Transport: transport}

	f := &Factory{target: cfg.Target, httpClient: httpClient, clients: map[string]any{}}
	switch cfg.Target {
	case environments.TargetFloci:
		f.flociEndpoint = cfg.FlociEndpoint
		// Retries are disabled on purpose: the console shows exactly the one
		// HTTP exchange that happened, and a local emulator gains nothing from retrying.
		f.base = sdkaws.Config{
			Region:       cfg.DefaultRegion,
			Credentials:  sdkaws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
			BaseEndpoint: sdkaws.String(cfg.FlociEndpoint),
			HTTPClient:   httpClient,
			Retryer:      func() sdkaws.Retryer { return sdkaws.NopRetryer{} },
			// Floci accepts checksums, but only computing them when required keeps
			// raw requests readable and avoids aws-chunked bodies for PutObject.
			RequestChecksumCalculation: sdkaws.RequestChecksumCalculationWhenRequired,
			ResponseChecksumValidation: sdkaws.ResponseChecksumValidationWhenRequired,
		}
	case environments.TargetAWS:
		// The SDK's standard retryer stays on: real AWS throttles, and the
		// captured exchange is the one of the last attempt.
		options := []func(*config.LoadOptions) error{config.WithHTTPClient(httpClient)}
		if cfg.DefaultRegion != "" {
			options = append(options, config.WithRegion(cfg.DefaultRegion))
		}
		base, err := config.LoadDefaultConfig(ctx, options...)
		if err != nil {
			return nil, fmt.Errorf("load AWS configuration: %w", err)
		}
		if base.Region == "" {
			return nil, errors.New("no AWS region configured: set AWS_REGION (or a region in the AWS profile)")
		}
		f.base = base
	default:
		return nil, fmt.Errorf("unknown target %q", cfg.Target)
	}
	return f, nil
}

// Target returns what the console operates.
func (f *Factory) Target() environments.Target { return f.target }

// DefaultRegion returns the region clients use when none is given.
func (f *Factory) DefaultRegion() string { return f.base.Region }

// FlociEndpoint returns the Floci endpoint all clients talk to (empty with TargetAWS).
func (f *Factory) FlociEndpoint() string { return f.flociEndpoint }

// HTTPClient returns the shared HTTP client.
func (f *Factory) HTTPClient() *http.Client { return f.httpClient }

// SDKConfig returns the base SDK configuration for a region.
func (f *Factory) SDKConfig(region string) sdkaws.Config {
	cfg := f.base.Copy()
	cfg.Region = region
	return cfg
}

// Client returns the cached client for (service, region), building it on first use.
func (f *Factory) Client(service, region string, build ClientBuilder) any {
	key := service + "|" + region
	f.mu.Lock()
	defer f.mu.Unlock()
	if client, ok := f.clients[key]; ok {
		return client
	}
	client := build(f.SDKConfig(region), f.target)
	f.clients[key] = client
	return client
}

// APIGatewayInvokeURL is the base URL that executes a deployed REST API stage;
// the resource path is appended to it.
//
// Floci serves stages under its own endpoint
// ({FLOCI}/restapis/{id}/{stage}/_user_request_), AWS under the execute-api host.
func (f *Factory) APIGatewayInvokeURL(region, restAPIID, stage string) string {
	if f.target == environments.TargetFloci {
		return fmt.Sprintf("%s/restapis/%s/%s/_user_request_", strings.TrimRight(f.flociEndpoint, "/"), restAPIID, stage)
	}
	suffix := "amazonaws.com"
	if strings.HasPrefix(region, "cn-") {
		suffix = "amazonaws.com.cn"
	}
	return fmt.Sprintf("https://%s.execute-api.%s.%s/%s", restAPIID, region, suffix, stage)
}
