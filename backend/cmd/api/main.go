// Command api runs the AWS Local Console Go API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/edermanoel94/aws-local-console/backend/internal/api"
	"github.com/edermanoel94/aws-local-console/backend/internal/architecture"
	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	consoleaws "github.com/edermanoel94/aws-local-console/backend/internal/aws"
	"github.com/edermanoel94/aws-local-console/backend/internal/cli"
	"github.com/edermanoel94/aws-local-console/backend/internal/coverage"
	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
	"github.com/edermanoel94/aws-local-console/backend/internal/operations"
	"github.com/edermanoel94/aws-local-console/backend/internal/resources"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

const auditCapacity = 2000

func main() {
	level := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		level = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	cfg, err := environments.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()
	factory, err := consoleaws.NewFactory(startupCtx, cfg)
	if err != nil {
		logger.Error("could not configure the AWS SDK", "target", cfg.Target, "error", err)
		os.Exit(1)
	}
	cfg.DefaultRegion = factory.DefaultRegion()
	registry := services.NewRegistry(factory)
	monitor := consoleaws.NewMonitor(factory, 5*time.Second)
	if cfg.Target == environments.TargetAWS {
		// Resolves the account id used in ARNs. Failing credentials are not
		// fatal: the console reports them and a later check picks up new ones.
		if status := monitor.Check(startupCtx); status.Healthy {
			logger.Info("AWS credentials resolved", "account", status.Identity.AccountID, "identity", status.Identity.ARN, "source", status.CredentialSource)
		} else {
			logger.Warn("AWS credentials are not usable yet", "state", status.State, "error", status.Error)
		}
	}

	started := time.Now()
	catalog := operations.NewCatalog(registry, cfg.DefaultRegion)
	logger.Info("operation catalog ready", "services", len(registry.All()), "durationMs", time.Since(started).Milliseconds())

	tracker := coverage.NewTracker()
	store := audit.NewStore(auditCapacity, monitor.AccountID)
	engine := operations.NewEngine(cfg.Target, registry, catalog, tracker, store, cfg.DefaultRegion, logger)
	discoverer := resources.NewDiscoverer(registry, monitor.AccountID, cfg.RegionNames(), logger)

	handler := api.NewHandler(api.Dependencies{
		Config:       cfg,
		Factory:      factory,
		Registry:     registry,
		Catalog:      catalog,
		Coverage:     tracker,
		Audit:        store,
		Engine:       engine,
		Discoverer:   discoverer,
		Architecture: architecture.NewBuilder(discoverer),
		CLI:          cli.NewRunner(cfg.Target, engine, registry, cfg.DefaultRegion),
		Monitor:      monitor,
		Logger:       logger,
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		attrs := []any{"addr", server.Addr, "target", cfg.Target, "region", cfg.DefaultRegion, "corsOrigins", cfg.CORSOrigins}
		if cfg.Target == environments.TargetFloci {
			attrs = append(attrs, "floci", cfg.FlociEndpoint)
		}
		logger.Info("AWS Local Console API listening", attrs...)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	logger.Info("server stopped")
}
