// Package environments holds the runtime configuration of the API: the target
// the console operates (Floci or a real AWS account), the Floci endpoint and
// credentials, the default region and the list of regions offered to the UI.
package environments

import (
	"fmt"
	"os"
	"strings"
)

// Target is what the console operates.
type Target string

const (
	// TargetFloci is a local Floci emulator (the default).
	TargetFloci Target = "floci"
	// TargetAWS is a real AWS account, reached with the AWS SDK default
	// credential chain (environment variables, shared config and credentials
	// files, SSO, web identity, container and instance roles).
	TargetAWS Target = "aws"
)

// DisplayName is the name the UI and messages use for the target.
func (t Target) DisplayName() string {
	if t == TargetAWS {
		return "AWS"
	}
	return "Floci"
}

// FlociAccountID is the fixed account id of every Floci resource.
const FlociAccountID = "000000000000"

// Config is the process configuration, read from environment variables.
type Config struct {
	Target Target
	// FlociEndpoint, AccessKeyID and SecretAccessKey are only used with TargetFloci.
	FlociEndpoint   string
	AccessKeyID     string
	SecretAccessKey string
	// DefaultRegion is empty with TargetAWS when AWS_REGION is not set: the SDK
	// then resolves it from AWS_DEFAULT_REGION or the shared config profile.
	DefaultRegion string
	Port          string
	CORSOrigins   []string
}

// Load reads the configuration from the environment, applying defaults suited
// for local development.
func Load() (Config, error) {
	origins := []string{}
	for _, origin := range strings.Split(getenv("CORS_ORIGINS", "http://localhost:4500"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	target := Target(strings.ToLower(getenv("CONSOLE_TARGET", string(TargetFloci))))
	if target != TargetFloci && target != TargetAWS {
		return Config{}, fmt.Errorf("CONSOLE_TARGET must be %q or %q, got %q", TargetFloci, TargetAWS, target)
	}
	cfg := Config{
		Target:      target,
		Port:        getenv("PORT", "8080"),
		CORSOrigins: origins,
	}
	switch target {
	case TargetFloci:
		cfg.FlociEndpoint = strings.TrimRight(getenv("FLOCI_ENDPOINT", "http://localhost:4566"), "/")
		cfg.AccessKeyID = getenv("AWS_ACCESS_KEY_ID", "test")
		cfg.SecretAccessKey = getenv("AWS_SECRET_ACCESS_KEY", "test")
		cfg.DefaultRegion = getenv("AWS_REGION", "us-east-1")
	case TargetAWS:
		cfg.DefaultRegion = getenv("AWS_REGION", "")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// Region is a region offered by the console.
type Region struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Default bool   `json:"default"`
}

var regionLabels = []Region{
	{Name: "us-east-1", Label: "US East (N. Virginia)"},
	{Name: "us-east-2", Label: "US East (Ohio)"},
	{Name: "us-west-2", Label: "US West (Oregon)"},
	{Name: "eu-west-1", Label: "Europe (Ireland)"},
	{Name: "sa-east-1", Label: "South America (Sao Paulo)"},
}

// Regions returns the regions offered by the console, flagging the default one.
// The configured default region is always part of the list.
func (c Config) Regions() []Region {
	regions := make([]Region, 0, len(regionLabels)+1)
	found := false
	for _, region := range regionLabels {
		region.Default = region.Name == c.DefaultRegion
		found = found || region.Default
		regions = append(regions, region)
	}
	if !found {
		regions = append([]Region{{Name: c.DefaultRegion, Label: c.DefaultRegion, Default: true}}, regions...)
	}
	return regions
}

// RegionNames returns only the names of Regions().
func (c Config) RegionNames() []string {
	names := []string{}
	for _, region := range c.Regions() {
		names = append(names, region.Name)
	}
	return names
}

// IsKnownRegion reports whether name is one of the offered regions.
func (c Config) IsKnownRegion(name string) bool {
	for _, region := range c.Regions() {
		if region.Name == name {
			return true
		}
	}
	return false
}
