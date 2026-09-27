package logging

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestParseLevel(t *testing.T) {
	cases := map[string]slog.Level{
		"":        slog.LevelInfo,
		"trace":   LevelTrace,
		"TRACE":   LevelTrace,
		"debug":   slog.LevelDebug,
		" Info ":  slog.LevelInfo,
		"warn":    slog.LevelWarn,
		"WARNING": slog.LevelWarn,
		"error":   slog.LevelError,
	}
	for value, want := range cases {
		got, err := ParseLevel(value)
		if err != nil || got != want {
			t.Errorf("ParseLevel(%q) = %v, %v; want %v", value, got, err, want)
		}
	}
	if level, err := ParseLevel("verbose"); err == nil || level != slog.LevelInfo {
		t.Errorf(`ParseLevel("verbose") = %v, %v; want INFO and an error`, level, err)
	}
}

func TestLoggerFiltersAndLabelsLevels(t *testing.T) {
	for _, tc := range []struct {
		level string
		want  []string
	}{
		{"trace", []string{"TRACE", "DEBUG", "INFO", "WARNING", "ERROR"}},
		{"debug", []string{"DEBUG", "INFO", "WARNING", "ERROR"}},
		{"info", []string{"INFO", "WARNING", "ERROR"}},
		{"warning", []string{"WARNING", "ERROR"}},
		{"error", []string{"ERROR"}},
	} {
		t.Run(tc.level, func(t *testing.T) {
			level, _ := ParseLevel(tc.level)
			var out bytes.Buffer
			logger := New(&out, level)
			Trace(context.Background(), logger, "message")
			logger.Debug("message")
			logger.Info("message")
			logger.Warn("message")
			logger.Error("message")

			got := []string{}
			for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
				for _, field := range strings.Fields(line) {
					if name, ok := strings.CutPrefix(field, "level="); ok {
						got = append(got, name)
					}
				}
			}
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Errorf("LOG_LEVEL=%s printed %v; want %v", tc.level, got, tc.want)
			}
		})
	}
}
