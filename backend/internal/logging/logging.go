// Package logging builds the API logger: TRACE, DEBUG, INFO, WARNING and ERROR
// levels, chosen with the LOG_LEVEL environment variable.
package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
)

// LevelTrace is below slog.LevelDebug: payloads and wire details of every call.
const LevelTrace = slog.Level(-8)

// Levels are the accepted LOG_LEVEL values, from the most to the least verbose.
var Levels = []string{"trace", "debug", "info", "warning", "error"}

// ParseLevel reads a LOG_LEVEL value (any case). Empty means INFO; "warn" is
// accepted as a synonym of "warning".
func ParseLevel(value string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "trace":
		return LevelTrace, nil
	case "debug":
		return slog.LevelDebug, nil
	case "", "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return slog.LevelInfo, fmt.Errorf("unknown log level %q (use one of %s)", value, strings.Join(Levels, ", "))
}

// LevelName is the label printed for a level: TRACE, DEBUG, INFO, WARNING or ERROR.
func LevelName(level slog.Level) string {
	switch {
	case level < slog.LevelDebug:
		return "TRACE"
	case level < slog.LevelInfo:
		return "DEBUG"
	case level < slog.LevelWarn:
		return "INFO"
	case level < slog.LevelError:
		return "WARNING"
	}
	return "ERROR"
}

// New returns a text logger that writes records at level or above to w.
func New(w io.Writer, level slog.Leveler) *slog.Logger {
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, attr slog.Attr) slog.Attr {
			if len(groups) == 0 && attr.Key == slog.LevelKey {
				if level, ok := attr.Value.Any().(slog.Level); ok {
					attr.Value = slog.StringValue(LevelName(level))
				}
			}
			return attr
		},
	}))
}

// Trace logs at TRACE, which slog.Logger has no method for.
func Trace(ctx context.Context, logger *slog.Logger, msg string, args ...any) {
	logger.Log(ctx, LevelTrace, msg, args...)
}
