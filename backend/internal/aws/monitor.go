package aws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/smithy-go"

	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
)

// Target states reported by Status.State.
const (
	StateHealthy      = "Healthy"
	StateUnreachable  = "Unreachable"
	StateUnauthorized = "Unauthorized"
)

// Identity is the AWS identity the console calls AWS with.
type Identity struct {
	AccountID string
	ARN       string
	UserID    string
}

// Status is the health of the target.
type Status struct {
	Target  environments.Target
	Healthy bool
	State   string
	// Version, Edition and Services come from Floci's GET /_floci/health.
	Version  string
	Edition  string
	Services map[string]string
	// Identity comes from sts:GetCallerIdentity with TargetAWS; with TargetFloci
	// only its AccountID is set.
	Identity Identity
	// CredentialSource names the SDK credentials provider (TargetAWS only).
	CredentialSource string
	Latency          time.Duration
	Error            string
	CheckedAt        time.Time
}

// ServiceIDs returns the Floci service ids in stable order.
func (s Status) ServiceIDs() []string {
	ids := make([]string, 0, len(s.Services))
	for id := range s.Services {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Available reports whether a service can be used: Floci must list it as
// running, AWS only needs working credentials.
func (s Status) Available(flociID string) bool {
	if s.Target == environments.TargetAWS {
		return s.Healthy
	}
	return s.Services[flociID] == "running"
}

// Monitor checks the target health and caches it briefly so that listing
// services does not hit the target on every request. With TargetAWS it also
// resolves the account id, which is needed to build ARNs.
type Monitor struct {
	factory *Factory
	ttl     time.Duration

	mu      sync.Mutex
	last    *Status
	account string
}

// NewMonitor returns a monitor of the factory's target.
func NewMonitor(f *Factory, ttl time.Duration) *Monitor {
	m := &Monitor{factory: f, ttl: ttl}
	if f.Target() == environments.TargetFloci {
		m.account = environments.FlociAccountID
	}
	return m
}

// AccountID returns the account id of the target. With TargetAWS it is the
// account of the last successful check, and empty before the first one.
func (m *Monitor) AccountID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.account
}

// Cached returns a recent health result, refreshing it when older than the TTL.
func (m *Monitor) Cached(ctx context.Context) Status {
	m.mu.Lock()
	if m.last != nil && time.Since(m.last.CheckedAt) < m.ttl {
		status := *m.last
		m.mu.Unlock()
		return status
	}
	m.mu.Unlock()
	return m.Check(ctx)
}

// Check queries the target now and stores the result.
func (m *Monitor) Check(ctx context.Context) Status {
	var status Status
	switch m.factory.Target() {
	case environments.TargetAWS:
		status = m.checkAWS(ctx)
	default:
		status = m.checkFloci(ctx)
	}
	m.mu.Lock()
	m.last = &status
	if status.Identity.AccountID != "" {
		m.account = status.Identity.AccountID
	}
	m.mu.Unlock()
	return status
}

func (m *Monitor) checkFloci(ctx context.Context) Status {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	status := Status{
		Target:    environments.TargetFloci,
		State:     StateUnreachable,
		Services:  map[string]string{},
		Identity:  Identity{AccountID: environments.FlociAccountID},
		CheckedAt: time.Now(),
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.factory.FlociEndpoint()+"/_floci/health", nil)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	start := time.Now()
	resp, err := m.factory.HTTPClient().Do(req)
	status.Latency = time.Since(start)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		status.Error = fmt.Sprintf("floci health returned HTTP %d", resp.StatusCode)
		return status
	}
	var body struct {
		Version  string            `json:"version"`
		Edition  string            `json:"edition"`
		Services map[string]string `json:"services"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		status.Error = "invalid floci health payload: " + err.Error()
		return status
	}
	status.Healthy = true
	status.State = StateHealthy
	status.Version = body.Version
	status.Edition = body.Edition
	if body.Services != nil {
		status.Services = body.Services
	}
	return status
}

// checkAWS resolves the credentials and calls sts:GetCallerIdentity, which
// needs no permission and proves that the credentials are valid.
func (m *Monitor) checkAWS(ctx context.Context) Status {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	status := Status{Target: environments.TargetAWS, State: StateUnauthorized, CheckedAt: time.Now()}
	cfg := m.factory.SDKConfig(m.factory.DefaultRegion())
	start := time.Now()
	creds, err := cfg.Credentials.Retrieve(ctx)
	if err != nil {
		status.Latency = time.Since(start)
		status.Error = "could not load AWS credentials: " + err.Error()
		return status
	}
	status.CredentialSource = creds.Source
	client := m.factory.Client("sts", cfg.Region, func(cfg sdkaws.Config, _ environments.Target) any { return sts.NewFromConfig(cfg) }).(*sts.Client)
	out, err := client.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	status.Latency = time.Since(start)
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			status.Error = apiErr.ErrorCode() + ": " + apiErr.ErrorMessage()
		} else {
			status.State = StateUnreachable
			status.Error = rootMessage(err)
		}
		return status
	}
	status.Healthy = true
	status.State = StateHealthy
	status.Identity = Identity{
		AccountID: sdkaws.ToString(out.Account),
		ARN:       sdkaws.ToString(out.Arn),
		UserID:    sdkaws.ToString(out.UserId),
	}
	return status
}

// rootMessage returns the innermost error message, without the SDK's
// "operation error STS: GetCallerIdentity, ..." prefixes.
func rootMessage(err error) string {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err.Error()
		}
		err = next
	}
}
