// Package environments holds the runtime configuration of the API: the Floci
// endpoint, credentials, default region and the list of regions offered to the UI.
package environments

import (
	"os"
	"strings"
)

// Config is the process configuration, read from environment variables.
type Config struct {
	FlociEndpoint   string
	DefaultRegion   string
	AccessKeyID     string
	SecretAccessKey string
	Port            string
	CORSOrigins     []string
	AccountID       string
}

// Load reads the configuration from the environment, applying defaults suited
// for local development.
func Load() Config {
	origins := []string{}
	for _, origin := range strings.Split(getenv("CORS_ORIGINS", "http://localhost:4500"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	return Config{
		FlociEndpoint:   strings.TrimRight(getenv("FLOCI_ENDPOINT", "http://localhost:4566"), "/"),
		DefaultRegion:   getenv("AWS_REGION", "us-east-1"),
		AccessKeyID:     getenv("AWS_ACCESS_KEY_ID", "test"),
		SecretAccessKey: getenv("AWS_SECRET_ACCESS_KEY", "test"),
		Port:            getenv("PORT", "8080"),
		CORSOrigins:     origins,
		AccountID:       "000000000000",
	}
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
